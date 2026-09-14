// 증빙 토큰 — 05-SECURITY "위협 1"의 요구사항을 실제 DB에 붙여서 확인한다.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { createOwnerPool, getAppPool } from "../db/client";
import { createEvidenceRequest } from "../lib/evidence";
import { hashToken, issueToken, lookupByToken, signWithToken, TOKEN_TTL_DAYS } from "../lib/token";

const owner = createOwnerPool();

interface Tenant {
  companyId: string;
  shipmentId: string;
}

let A: Tenant;
let B: Tenant;

async function seed(name: string): Promise<Tenant> {
  const company = await owner.query<{ id: string }>(
    "INSERT INTO company (name) VALUES ($1) RETURNING id",
    [name],
  );
  const companyId = company.rows[0]!.id;
  const shipment = await owner.query<{ id: string }>(
    `INSERT INTO shipment (company_id, cargo_type, shipped_on, driver_phone, memo)
     VALUES ($1, 'CONTAINER_40', '2026-08-15', '010-1234-5678', '내부 메모') RETURNING id`,
    [companyId],
  );
  return { companyId, shipmentId: shipment.rows[0]!.id };
}

before(async () => {
  A = await seed("가나운수");
  B = await seed("다라물류");
});

beforeEach(async () => {
  // 속도 제한이 앞선 테스트에 걸리지 않게 비운다.
  await owner.query("DELETE FROM token_lookup");
});

after(async () => {
  await owner.query("DELETE FROM company WHERE id = ANY($1)", [[A.companyId, B.companyId]]);
  await owner.query("DELETE FROM token_lookup");
  await owner.end();
  await getAppPool().end();
});

test("토큰은 CSPRNG 32바이트다", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const { token, hash } = issueToken();
    // base64url로 32바이트는 43글자.
    assert.equal(token.length, 43);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(hash.length, 32);
    seen.add(token);
  }
  assert.equal(seen.size, 200, "같은 토큰이 두 번 나왔다");
});

test("DB에는 해시만 남는다. 원문 토큰은 어디에도 없다", async () => {
  const issued = await createEvidenceRequest(A.companyId, A.shipmentId, "WAIT");

  const { rows } = await owner.query<{ token_hash: Buffer }>(
    "SELECT token_hash FROM evidence WHERE id = $1",
    [issued.evidenceId],
  );
  assert.deepEqual(rows[0]!.token_hash, hashToken(issued.token));

  // 행 전체를 글자로 훑어도 원문이 나오면 안 된다.
  const scan = await owner.query<{ n: string }>(
    "SELECT count(*) AS n FROM evidence WHERE evidence::text LIKE $1",
    [`%${issued.token.slice(0, 16)}%`],
  );
  assert.equal(scan.rows[0]!.n, "0");
});

test("만료는 7일이다", async () => {
  const issued = await createEvidenceRequest(A.companyId, A.shipmentId, "WAIT");
  const days = (issued.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  assert.ok(Math.abs(days - TOKEN_TTL_DAYS) < 0.01, `${days}일`);
});

test("맞는 토큰은 서명 전 최소 정보만 돌려준다", async () => {
  const issued = await createEvidenceRequest(A.companyId, A.shipmentId, "WAIT");
  const result = await lookupByToken(issued.token, "203.0.113.1");
  assert.equal(result.state, "ok");
  if (result.state !== "ok") return;

  assert.deepEqual(Object.keys(result.view).sort(), [
    "cargoType", "companyId", "companyName", "evidenceId", "kind", "shipmentId", "shippedOn",
  ]);
  assert.equal(result.view.companyName, "가나운수");
  assert.equal(result.view.shippedOn, "2026-08-15");

  // 서명 전 화면에 나가면 안 되는 것들.
  const serialized = JSON.stringify(result.view);
  assert.equal(serialized.includes("010-1234-5678"), false, "차주 연락처가 새어 나간다");
  assert.equal(serialized.includes("내부 메모"), false, "메모가 새어 나간다");
});

test("토큰 문자열을 바꾸면 아무것도 열리지 않는다", async () => {
  const issued = await createEvidenceRequest(A.companyId, A.shipmentId, "WAIT");

  const mutations = [
    issued.token.slice(0, -1) + (issued.token.endsWith("a") ? "b" : "a"), // 끝 한 글자
    (issued.token[0] === "a" ? "b" : "a") + issued.token.slice(1),        // 앞 한 글자
    issued.token.slice(0, -1),                                            // 잘라내기
    issued.token + "a",                                                   // 덧붙이기
    issued.token.toUpperCase(),                                           // 대문자로
  ];

  for (const mutated of mutations) {
    if (mutated === issued.token) continue;
    const result = await lookupByToken(mutated, "203.0.113.2");
    assert.deepEqual(result, { state: "gone" }, `열려버린 변형: ${mutated.slice(0, 12)}…`);
  }
});

test("A의 토큰으로 B의 증빙에 닿지 않는다", async () => {
  const tokenA = await createEvidenceRequest(A.companyId, A.shipmentId, "WAIT");
  const tokenB = await createEvidenceRequest(B.companyId, B.shipmentId, "ROUGH_ROAD");

  const seenA = await lookupByToken(tokenA.token, "203.0.113.3");
  assert.equal(seenA.state === "ok" && seenA.view.evidenceId, tokenA.evidenceId);
  assert.equal(seenA.state === "ok" && seenA.view.companyName, "가나운수");

  const seenB = await lookupByToken(tokenB.token, "203.0.113.3");
  assert.equal(seenB.state === "ok" && seenB.view.evidenceId, tokenB.evidenceId);

  // 토큰 1개 = 증빙 1건. 서로의 것이 섞이지 않는다.
  assert.notEqual(tokenA.evidenceId, tokenB.evidenceId);
});

test("없는 토큰과 만료된 토큰의 응답이 구분되지 않는다", async () => {
  const issued = await createEvidenceRequest(A.companyId, A.shipmentId, "WAIT");
  await owner.query("UPDATE evidence SET expires_at = now() - interval '1 hour' WHERE id = $1", [
    issued.evidenceId,
  ]);

  const expired = await lookupByToken(issued.token, "203.0.113.4");
  const missing = await lookupByToken(randomBytes(32).toString("base64url"), "203.0.113.4");

  assert.deepEqual(expired, { state: "gone" });
  assert.deepEqual(missing, { state: "gone" });
  assert.deepEqual(expired, missing, "두 응답이 다르다");
});

test("만료된 토큰으로는 서명할 수 없다", async () => {
  const issued = await createEvidenceRequest(A.companyId, A.shipmentId, "WAIT");
  await owner.query("UPDATE evidence SET expires_at = now() - interval '1 hour' WHERE id = $1", [
    issued.evidenceId,
  ]);

  const signed = await signWithToken({
    token: issued.token,
    signerName: "박영희",
    signerRole: "SHIPPER",
    payload: { arrivedAt: "08:40" },
    signaturePath: "signatures/x.png",
    ip: "203.0.113.5",
    userAgent: "test",
  });
  assert.equal(signed, null);
});

test("서명하면 IP와 UA가 남고, 같은 토큰으로 다시 고칠 수 없다", async () => {
  const issued = await createEvidenceRequest(A.companyId, A.shipmentId, "WAIT");

  const first = await signWithToken({
    token: issued.token,
    signerName: "박영희",
    signerRole: "SHIPPER",
    payload: { arrivedAt: "08:40", loadStartAt: "11:15" },
    signaturePath: "signatures/first.png",
    ip: "203.0.113.6",
    userAgent: "Mozilla/5.0 (test)",
  });
  assert.equal(first?.evidenceId, issued.evidenceId);

  const { rows } = await owner.query<{
    status: string; signer_name: string; signer_ip: string;
    signer_user_agent: string; payload_json: Record<string, string>; signed_at: Date;
  }>("SELECT * FROM evidence WHERE id = $1", [issued.evidenceId]);
  const row = rows[0]!;
  assert.equal(row.status, "SIGNED");
  assert.equal(row.signer_name, "박영희");
  assert.equal(row.signer_ip, "203.0.113.6");
  assert.equal(row.signer_user_agent, "Mozilla/5.0 (test)");
  assert.deepEqual(row.payload_json, { arrivedAt: "08:40", loadStartAt: "11:15" });
  assert.ok(row.signed_at);

  // 두 번째 시도는 아무 행도 바꾸지 않는다.
  const second = await signWithToken({
    token: issued.token,
    signerName: "다른사람",
    signerRole: "DRIVER",
    payload: { arrivedAt: "23:59" },
    signaturePath: "signatures/second.png",
    ip: "203.0.113.7",
    userAgent: "attacker",
  });
  assert.equal(second, null);

  const after = await owner.query<{ signer_name: string; signature_png_path: string }>(
    "SELECT signer_name, signature_png_path FROM evidence WHERE id = $1",
    [issued.evidenceId],
  );
  assert.equal(after.rows[0]!.signer_name, "박영희", "서명이 덮어써졌다");
  assert.equal(after.rows[0]!.signature_png_path, "signatures/first.png");

  // 조회하면 "이미 서명됨"이고, 내용은 보여주지 않는다.
  const seen = await lookupByToken(issued.token, "203.0.113.8");
  assert.deepEqual(seen, { state: "signed" });
});

test("실패가 몰리면 IP를 막는다 (열거 공격 차단)", async () => {
  const issued = await createEvidenceRequest(A.companyId, A.shipmentId, "WAIT");
  const ip = "198.51.100.9";

  for (let i = 0; i < 10; i++) {
    const result = await lookupByToken(randomBytes(32).toString("base64url"), ip);
    assert.equal(result.state, "gone", `${i}번째에서 막혔다`);
  }

  // 11번째는 맞는 토큰이어도 막힌다.
  assert.deepEqual(await lookupByToken(issued.token, ip), { state: "throttled" });

  // 다른 IP는 영향을 받지 않는다.
  assert.equal((await lookupByToken(issued.token, "198.51.100.10")).state, "ok");
});

test("정상 서명자가 새로고침을 몇 번 해도 잠기지 않는다", async () => {
  const issued = await createEvidenceRequest(A.companyId, A.shipmentId, "WAIT");
  const ip = "198.51.100.20";

  // 실패 상한(10)보다 많이 열어도, 맞는 토큰이면 계속 열려야 한다.
  for (let i = 0; i < 20; i++) {
    const result = await lookupByToken(issued.token, ip);
    assert.equal(result.state, "ok", `${i + 1}번째 새로고침에서 막혔다`);
  }
});

test("맞는 토큰이라도 분당 전체 상한을 넘으면 막는다", async () => {
  const issued = await createEvidenceRequest(A.companyId, A.shipmentId, "WAIT");
  const ip = "198.51.100.21";

  for (let i = 0; i < 60; i++) await lookupByToken(issued.token, ip);
  assert.deepEqual(await lookupByToken(issued.token, ip), { state: "throttled" });
});

test("조회 기록에 토큰이 남지 않는다", async () => {
  const issued = await createEvidenceRequest(A.companyId, A.shipmentId, "WAIT");
  await lookupByToken(issued.token, "203.0.113.11");

  const { rows } = await owner.query<{ n: string }>(
    "SELECT count(*) AS n FROM token_lookup WHERE token_lookup::text LIKE $1",
    [`%${issued.token.slice(0, 12)}%`],
  );
  assert.equal(rows[0]!.n, "0");
});
