// 테넌트 분리 — 실제 DB에 붙어서 남의 데이터에 닿는지 시도한다.
//
// 05-SECURITY 위협 2: "계정 2개를 만들어 실제로 남의 ID를 넣어본다.
// 코드를 읽는 건 검증이 아니다."
//
// 돌리는 법:
//   DATABASE_URL=... DATABASE_URL_APP=... npm test

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { assertAppRoleIsRestricted, createOwnerPool, getAppPool } from "../db/client";
import { withCompany, withoutCompany } from "../db/tenant";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Tenant {
  companyId: string;
  userEmail: string;
  shipmentId: string;
  evidenceId: string;
  token: string;
}

const owner = createOwnerPool();
let A: Tenant;
let B: Tenant;

function tokenHash(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

/** 소유자 역할로 한 회사분 데이터를 심는다. 여기서만 RLS를 넘어간다. */
async function seed(name: string): Promise<Tenant> {
  const suffix = randomBytes(4).toString("hex");
  const company = await owner.query<{ id: string }>(
    "INSERT INTO company (name) VALUES ($1) RETURNING id",
    [name],
  );
  const companyId = company.rows[0]!.id;

  const userEmail = `${suffix}@example.com`;
  await owner.query(
    "INSERT INTO app_user (company_id, email, password_hash, name) VALUES ($1, $2, $3, $4)",
    [companyId, userEmail, "$argon2id$placeholder", `${name} 담당자`],
  );

  const shipment = await owner.query<{ id: string }>(
    `INSERT INTO shipment (company_id, cargo_type, shipped_on, origin, destination,
                           driver_name, driver_phone, shipper_name, memo)
     VALUES ($1, 'CONTAINER_40', '2026-08-15', '부산 신항', '경남 양산',
             '김철수', '010-0000-0000', '평택항 제일물류센터', '내부 메모')
     RETURNING id`,
    [companyId],
  );
  const shipmentId = shipment.rows[0]!.id;

  const token = randomBytes(32).toString("base64url");
  const evidence = await owner.query<{ id: string }>(
    `INSERT INTO evidence (shipment_id, company_id, kind, token_hash, expires_at)
     VALUES ($1, $2, 'WAIT', $3, now() + interval '7 days')
     RETURNING id`,
    [shipmentId, companyId, tokenHash(token)],
  );

  return { companyId, userEmail, shipmentId, evidenceId: evidence.rows[0]!.id, token };
}

before(async () => {
  A = await seed("가나운수");
  B = await seed("다라물류");
});

after(async () => {
  await owner.query("DELETE FROM company WHERE id = ANY($1)", [[A.companyId, B.companyId]]);
  await owner.end();
  await getAppPool().end();
});

test("앱 역할이 RLS를 우회할 수 없는 역할이다", async () => {
  await assertAppRoleIsRestricted();
});

test("모든 id가 UUID다 (자동증가 정수가 아니다)", async () => {
  const { rows } = await owner.query<{ table_name: string; data_type: string }>(
    `SELECT table_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'id'
       AND table_name IN ('company','app_user','shipment','evidence','fee_calc')
     ORDER BY table_name`,
  );
  assert.equal(rows.length, 5);
  for (const row of rows) assert.equal(row.data_type, "uuid", `${row.table_name}.id`);

  assert.match(A.companyId, UUID_RE);
  assert.match(A.shipmentId, UUID_RE);
  assert.match(A.evidenceId, UUID_RE);
});

test("어느 테이블도 자동증가 정수 id를 쓰지 않는다", async () => {
  // "모든 id는 UUID. 자동증가 정수 금지" (06-FAST-TRACK A1, 03-BUILD-PROMPT 명령 3).
  // 새 테이블을 만들 때 bigserial을 쓰면 여기서 걸린다. 점검에서 실제로 두 개를
  // 놓쳤던 자리라 검사로 박아둔다.
  const { rows } = await owner.query<{ table_name: string; data_type: string; column_default: string | null }>(
    `SELECT table_name, data_type, column_default FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'id' AND table_name <> 'schema_migrations'
     ORDER BY table_name`,
  );
  assert.ok(rows.length >= 8, `id 칼럼이 있는 테이블이 ${rows.length}개뿐이다`);
  for (const row of rows) {
    assert.equal(row.data_type, "uuid", `${row.table_name}.id 가 uuid가 아니다`);
    assert.equal(
      row.column_default?.startsWith("nextval") ?? false,
      false,
      `${row.table_name}.id 가 자동증가다`,
    );
  }
});

test("다섯 테이블 모두 RLS가 켜져 있고 소유자에게도 강제된다", async () => {
  const { rows } = await owner.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
     WHERE relname IN ('company','app_user','shipment','evidence','fee_calc') ORDER BY relname`,
  );
  assert.equal(rows.length, 5);
  for (const row of rows) {
    assert.equal(row.relrowsecurity, true, `${row.relname} RLS`);
    assert.equal(row.relforcerowsecurity, true, `${row.relname} FORCE RLS`);
  }
});

test("자기 회사 데이터만 보인다", async () => {
  const rows = await withCompany(A.companyId, (sql) =>
    sql<{ id: string }>("SELECT id FROM shipment"),
  );
  assert.deepEqual(rows.map((r) => r.id), [A.shipmentId]);
});

test("남의 shipment id를 직접 넣어도 열리지 않는다", async () => {
  const rows = await withCompany(A.companyId, (sql) =>
    sql("SELECT id FROM shipment WHERE id = $1", [B.shipmentId]),
  );
  assert.deepEqual(rows, [], "B의 운송 건이 A에게 보였다");
});

test("남의 evidence·app_user·company도 열리지 않는다", async () => {
  const result = await withCompany(A.companyId, async (sql) => ({
    evidence: await sql("SELECT id FROM evidence WHERE id = $1", [B.evidenceId]),
    user: await sql("SELECT id FROM app_user WHERE email = $1", [B.userEmail]),
    company: await sql("SELECT id FROM company WHERE id = $1", [B.companyId]),
  }));
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.user, []);
  assert.deepEqual(result.company, []);
});

test("남의 데이터를 수정·삭제할 수 없다", async () => {
  const changed = await withCompany(A.companyId, async (sql) => ({
    updated: (await sql("UPDATE shipment SET memo = 'hacked' WHERE id = $1 RETURNING id", [B.shipmentId])).length,
    deleted: (await sql("DELETE FROM shipment WHERE id = $1 RETURNING id", [B.shipmentId])).length,
  }));
  assert.equal(changed.updated, 0);
  assert.equal(changed.deleted, 0);

  // 정말로 남아 있는지 소유자 눈으로 확인한다.
  const { rows } = await owner.query<{ memo: string }>("SELECT memo FROM shipment WHERE id = $1", [
    B.shipmentId,
  ]);
  assert.equal(rows[0]?.memo, "내부 메모");
});

test("남의 회사 이름으로 데이터를 심을 수 없다", async () => {
  await assert.rejects(
    withCompany(A.companyId, (sql) =>
      sql("INSERT INTO shipment (company_id, cargo_type, shipped_on) VALUES ($1, 'CEMENT', '2026-08-15')", [
        B.companyId,
      ]),
    ),
    /row-level security/i,
  );
});

test("남의 운송 건에 증빙을 달 수 없다 (복합 외래키)", async () => {
  await assert.rejects(
    withCompany(A.companyId, (sql) =>
      sql(
        `INSERT INTO evidence (shipment_id, company_id, kind, token_hash, expires_at)
         VALUES ($1, $2, 'WAIT', $3, now() + interval '7 days')`,
        [B.shipmentId, A.companyId, tokenHash("x")],
      ),
    ),
    /foreign key|violates/i,
  );
});

test("회사 맥락 없이는 아무 행도 보이지 않는다 (기본값이 차단)", async () => {
  const rows = await withoutCompany((sql) => sql("SELECT id FROM shipment"));
  assert.deepEqual(rows, []);
});

test("company_id가 UUID가 아니면 쿼리 전에 막는다", async () => {
  await assert.rejects(
    withCompany("' OR 1=1 --", async (sql) => sql("SELECT 1")),
    /UUID/,
  );
});

test("로그인 조회는 인증에 필요한 칼럼만 돌려준다", async () => {
  const rows = await withoutCompany((sql) =>
    sql<Record<string, unknown>>("SELECT * FROM auth_lookup_user($1)", [A.userEmail]),
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]!).sort(), ["company_id", "id", "name", "password_hash"]);
  assert.equal(rows[0]!.company_id, A.companyId);

  // 없는 계정은 빈 결과. 존재 여부를 응답에서 구분하지 못하게 하는 일은 앱의 몫이다(A2).
  assert.deepEqual(await withoutCompany((sql) => sql("SELECT * FROM auth_lookup_user($1)", ["없는@example.com"])), []);
});

test("토큰 조회는 증빙 1건과 최소 정보만 돌려준다", async () => {
  const rows = await withoutCompany((sql) =>
    sql<Record<string, unknown>>("SELECT * FROM evidence_by_token_hash($1)", [tokenHash(A.token)]),
  );
  assert.equal(rows.length, 1, "토큰 1개 = 증빙 1건");
  assert.equal(rows[0]!.evidence_id, A.evidenceId);
  assert.equal(rows[0]!.company_name, "가나운수");

  // 서명 전 화면에 나가면 안 되는 것들이 응답에 없어야 한다 (05-SECURITY 위협 1).
  //
  // token_hash는 예외다. 앱에서 상수 시간 비교를 한 번 더 하려고 일부러 돌려준다.
  // 부르는 쪽이 이미 들고 있는 토큰에서 나온 값이라 새로 알려주는 것이 없다.
  const keys = Object.keys(rows[0]!);
  for (const leaked of ["driver_phone", "driver_name", "memo", "origin", "destination", "payload_json"]) {
    assert.equal(keys.includes(leaked), false, `${leaked}가 서명 전 화면으로 새어 나간다`);
  }
  assert.equal(keys.includes("token_hash"), true, "상수 시간 비교에 쓸 해시가 빠졌다");
});

test("토큰 문자열을 바꾸면 아무것도 열리지 않는다", async () => {
  const wrong = A.token.slice(0, -1) + (A.token.endsWith("a") ? "b" : "a");
  const rows = await withoutCompany((sql) =>
    sql("SELECT * FROM evidence_by_token_hash($1)", [tokenHash(wrong)]),
  );
  assert.deepEqual(rows, []);
});
