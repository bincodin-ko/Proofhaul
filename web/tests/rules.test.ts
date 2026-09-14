// 규칙 모듈 — 숫자가 들어가지 않았는지, 버전 선택이 맞는지.
//
// 첫 번째 테스트가 이 단계의 핵심이다. 원문 대조 전에 누군가 "일단 대충" 값을
// 넣으면 여기서 터진다.

import assert from "node:assert/strict";
import { test } from "node:test";
import { RULE_SETS, rulesFor, rulesForVersion, toKstDate } from "../rules/index";
import { isUnsupported, requireSupported, type CargoType } from "../rules/types";

const CARGO: CargoType[] = ["CONTAINER_20", "CONTAINER_40", "CEMENT", "ETC"];

test("원문 대조 전이므로 모든 규칙 함수가 null을 돌려준다", () => {
  for (const rules of RULE_SETS) {
    for (const cargo of CARGO) {
      assert.equal(rules.waitThreshold(cargo), null, `${rules.version} waitThreshold(${cargo})`);
    }
    assert.equal(
      rules.surcharge({ cargo: "CONTAINER_40", shippedOn: "2026-08-15", facts: {} }),
      null,
      `${rules.version} surcharge`,
    );
    assert.equal(rules.fuelAdjustment(new Date("2026-08-15")), null, `${rules.version} fuelAdjustment`);
  }
});

test("버전이 두 개 있고 시행일이 다르다", () => {
  assert.deepEqual(
    RULE_SETS.map((r) => [r.version, r.effectiveFrom]),
    [
      ["2026.02", "2026-02-01"],
      ["2026.08", "2026-08-01"],
    ],
  );
});

test("운송 일자로 당시 버전을 고른다", () => {
  // 7월 건과 8월 건의 계산 기준이 다르다 — 이게 제품의 근거다 (00-PLAN).
  assert.equal(rulesFor("2026-02-01")?.version, "2026.02");
  assert.equal(rulesFor("2026-07-31")?.version, "2026.02");
  assert.equal(rulesFor("2026-08-01")?.version, "2026.08");
  assert.equal(rulesFor("2026-12-31")?.version, "2026.08");
});

test("확정된 버전이 없는 날짜는 가까운 버전으로 때우지 않고 null을 돌려준다", () => {
  assert.equal(rulesFor("2026-01-31"), null, "요율 시행 전");
  assert.equal(rulesFor("2027-01-01"), null, "2026년 고시 효력 밖");
});

test("KST 기준으로 날짜를 본다", () => {
  // 2026-08-01 00:30 KST = 2026-07-31 15:30 UTC.
  // UTC로 보면 7월이라 2026.02가 잡히고, 그러면 8월 건이 7월 기준으로 계산된다.
  const justAfterMidnightKst = new Date("2026-07-31T15:30:00Z");
  assert.equal(toKstDate(justAfterMidnightKst), "2026-08-01");
  assert.equal(rulesFor(justAfterMidnightKst)?.version, "2026.08");
});

test("calc_version으로 당시 규칙을 다시 꺼낸다", () => {
  assert.equal(rulesForVersion("2026.02")?.version, "2026.02");
  assert.equal(rulesForVersion("2026.08")?.version, "2026.08");
  assert.equal(rulesForVersion("2025.01"), null);
});

test("미확정 값을 0으로 떨어뜨리지 못하게 한다", () => {
  const value = RULE_SETS[0]!.waitThreshold("CONTAINER_20");
  assert.equal(isUnsupported(value), true);
  assert.throws(() => requireSupported(value, "대기료 기산 기준"), /미지원/);
});
