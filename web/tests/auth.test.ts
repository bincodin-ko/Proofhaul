// 로그인 — 05-SECURITY 위협 7의 요구사항을 실제로 돌려서 확인한다.

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { createOwnerPool, getAppPool } from "../db/client";
import { withCompany } from "../db/tenant";
import { LOGIN_FAILED_MESSAGE, THROTTLED_MESSAGE, login } from "../lib/auth";
import { hashPassword, passwordProblem } from "../lib/password";
import { destroySessionById, hashToken, lookupSession } from "../lib/session";

const owner = createOwnerPool();
const PASSWORD = "정확한비밀번호12345";

interface Account {
  companyId: string;
  userId: string;
  email: string;
}

let A: Account;
let B: Account;

async function seed(name: string): Promise<Account> {
  const company = await owner.query<{ id: string }>(
    "INSERT INTO company (name) VALUES ($1) RETURNING id",
    [name],
  );
  const companyId = company.rows[0]!.id;
  const email = `${randomBytes(5).toString("hex")}@example.com`;
  const user = await owner.query<{ id: string }>(
    "INSERT INTO app_user (company_id, email, password_hash, name) VALUES ($1,$2,$3,$4) RETURNING id",
    [companyId, email, await hashPassword(PASSWORD), `${name} 담당자`],
  );
  return { companyId, userId: user.rows[0]!.id, email };
}

/** 속도 제한이 앞선 테스트의 실패 기록에 걸리지 않게 비운다. */
async function clearAttempts() {
  await owner.query("DELETE FROM login_attempt");
}

before(async () => {
  A = await seed("가나운수");
  B = await seed("다라물류");
  await clearAttempts();
});

after(async () => {
  await owner.query("DELETE FROM company WHERE id = ANY($1)", [[A.companyId, B.companyId]]);
  await clearAttempts();
  await owner.end();
  await getAppPool().end();
});

test("맞는 비밀번호로 로그인하면 세션이 생긴다", async () => {
  await clearAttempts();
  const outcome = await login({ email: A.email, password: PASSWORD, ip: "203.0.113.10" });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  assert.equal(outcome.companyId, A.companyId);
  const session = await lookupSession(outcome.session.token);
  assert.equal(session?.companyId, A.companyId);
  assert.equal(session?.userId, A.userId);
});

test("세션 토큰은 해시로만 저장된다", async () => {
  await clearAttempts();
  const outcome = await login({ email: A.email, password: PASSWORD, ip: "203.0.113.10" });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  const { rows } = await owner.query<{ token_hash: Buffer }>(
    "SELECT token_hash FROM user_session ORDER BY created_at DESC LIMIT 1",
  );
  assert.deepEqual(rows[0]!.token_hash, hashToken(outcome.session.token));

  // 원문 토큰이 어느 칼럼에도 없어야 한다.
  const raw = await owner.query<{ hit: string }>(
    "SELECT id::text AS hit FROM user_session WHERE token_hash::text LIKE $1",
    [`%${outcome.session.token.slice(0, 12)}%`],
  );
  assert.deepEqual(raw.rows, []);
});

test("이메일 대소문자와 공백은 무시한다", async () => {
  await clearAttempts();
  const outcome = await login({
    email: `  ${A.email.toUpperCase()}  `,
    password: PASSWORD,
    ip: "203.0.113.10",
  });
  assert.equal(outcome.ok, true);
});

test("없는 계정과 틀린 비밀번호의 응답이 같다", async () => {
  await clearAttempts();
  const wrongPassword = await login({ email: A.email, password: "틀린비밀번호12345", ip: "203.0.113.11" });
  const noSuchUser = await login({ email: "없는사람@example.com", password: "틀린비밀번호12345", ip: "203.0.113.11" });

  assert.deepEqual(wrongPassword, { ok: false, message: LOGIN_FAILED_MESSAGE });
  assert.deepEqual(noSuchUser, { ok: false, message: LOGIN_FAILED_MESSAGE });
});

test("없는 계정도 비슷한 시간을 쓴다 (응답 시간으로 존재 여부가 새지 않게)", async () => {
  await clearAttempts();
  const time = async (email: string) => {
    const started = process.hrtime.bigint();
    await login({ email, password: "틀린비밀번호12345", ip: "203.0.113.12" });
    return Number(process.hrtime.bigint() - started) / 1e6;
  };

  await time(A.email); // 워밍업
  const existing = await time(A.email);
  const missing = await time("없는사람@example.com");

  // 정확히 같을 수는 없다. 없는 계정이 눈에 띄게 빠르지만 않으면 된다.
  assert.ok(
    missing > existing * 0.5,
    `없는 계정이 너무 빠르다: 있는 계정 ${existing.toFixed(1)}ms, 없는 계정 ${missing.toFixed(1)}ms`,
  );
});

test("이메일 기준 속도 제한에 걸리면 맞는 비밀번호도 거부한다", async () => {
  await clearAttempts();
  // 이메일 기준 상한은 10회. IP를 바꿔가며 실패시켜도 이메일로 걸려야 한다.
  for (let i = 0; i < 10; i++) {
    await login({ email: B.email, password: "틀린비밀번호12345", ip: `198.51.100.${i}` });
  }

  const throttled = await login({ email: B.email, password: PASSWORD, ip: "198.51.100.200" });
  assert.deepEqual(throttled, { ok: false, message: THROTTLED_MESSAGE });

  // 다른 계정은 영향을 받지 않는다.
  const other = await login({ email: A.email, password: PASSWORD, ip: "198.51.100.201" });
  assert.equal(other.ok, true);
});

test("IP 기준 속도 제한도 걸린다", async () => {
  await clearAttempts();
  const ip = "198.51.100.77";
  for (let i = 0; i < 20; i++) {
    await login({ email: `없는사람${i}@example.com`, password: "틀린비밀번호12345", ip });
  }
  const throttled = await login({ email: A.email, password: PASSWORD, ip });
  assert.deepEqual(throttled, { ok: false, message: THROTTLED_MESSAGE });
});

test("시도 기록에 이메일 평문이 남지 않는다", async () => {
  await clearAttempts();
  await login({ email: A.email, password: "틀린비밀번호12345", ip: "203.0.113.20" });

  const { rows } = await owner.query<{ n: string }>(
    "SELECT count(*) AS n FROM login_attempt WHERE encode(email_hash, 'escape') LIKE $1",
    [`%${A.email}%`],
  );
  assert.equal(rows[0]!.n, "0");

  // 대신 지문으로는 찾아진다.
  const fingerprint = createHash("sha256").update(`login:${A.email}`, "utf8").digest();
  const found = await owner.query<{ n: string }>(
    "SELECT count(*) AS n FROM login_attempt WHERE email_hash = $1",
    [fingerprint],
  );
  assert.equal(found.rows[0]!.n, "1");
});

test("만료된 세션은 열리지 않고 그 자리에서 지워진다", async () => {
  const token = randomBytes(32).toString("base64url");
  const inserted = await owner.query<{ id: string }>(
    `INSERT INTO user_session (user_id, company_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() - interval '1 day') RETURNING id`,
    [A.userId, A.companyId, hashToken(token)],
  );

  assert.equal(await lookupSession(token), null);

  const { rows } = await owner.query("SELECT id FROM user_session WHERE id = $1", [
    inserted.rows[0]!.id,
  ]);
  assert.deepEqual(rows, []);
});

test("토큰을 한 글자 바꾸면 열리지 않는다", async () => {
  await clearAttempts();
  const outcome = await login({ email: A.email, password: PASSWORD, ip: "203.0.113.30" });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  const token = outcome.session.token;
  const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
  assert.equal(await lookupSession(tampered), null);
  assert.notEqual(await lookupSession(token), null, "원래 토큰은 열려야 한다");
});

test("로그아웃하면 세션이 DB에서도 사라진다", async () => {
  await clearAttempts();
  const outcome = await login({ email: A.email, password: PASSWORD, ip: "203.0.113.40" });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  const session = await lookupSession(outcome.session.token);
  assert.ok(session);
  await destroySessionById(session.sessionId, session.companyId);
  assert.equal(await lookupSession(outcome.session.token), null);
});

test("A의 세션으로는 B의 데이터에 닿지 않는다", async () => {
  await clearAttempts();
  const outcome = await login({ email: A.email, password: PASSWORD, ip: "203.0.113.50" });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  const session = await lookupSession(outcome.session.token);
  assert.ok(session);

  // 세션이 알려주는 회사로만 맥락을 연다. 그 안에서 B를 조회해도 보이지 않는다.
  const seen = await withCompany(session.companyId, (sql) =>
    sql("SELECT id FROM company WHERE id = $1", [B.companyId]),
  );
  assert.deepEqual(seen, []);

  // B의 세션 행도 A의 맥락에서는 안 보인다.
  const sessions = await withCompany(session.companyId, (sql) =>
    sql<{ company_id: string }>("SELECT company_id FROM user_session"),
  );
  assert.ok(sessions.every((s) => s.company_id === A.companyId));
});

test("짧은 비밀번호는 거부한다", () => {
  assert.match(passwordProblem("짧다") ?? "", /10자/);
  assert.equal(passwordProblem(PASSWORD), null);
});
