// 버전 선택기.
//
// 원문 미대조 — docs/02-RULES-v2026.md B절 참조.
//
// 운송 일자를 주면 그 시점에 효력이 있던 규칙 버전을 돌려준다.
// 과거 건은 최신 규칙이 아니라 **당시 버전**으로 재계산해야 한다
// (01-SPEC "calc_version이 핵심이다").

import type { RuleSet } from "./types";
import { v2026_02 } from "./v2026-02";
import { v2026_08 } from "./v2026-08";

/** 시행일 순으로 둔다. 뒤에서부터 찾으면 가장 늦게 시행된 것이 잡힌다. */
export const RULE_SETS: readonly RuleSet[] = [v2026_02, v2026_08];

export * from "./types";
export { v2026_02, v2026_08 };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const KST = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Date를 KST 기준 YYYY-MM-DD로 바꾼다.
 *
 * 운송 일자는 한국 날짜다. UTC로 비교하면 자정 근처 건이 하루 밀려서
 * 8월 1일 건이 7월 버전으로 계산되는 일이 생긴다.
 */
export function toKstDate(value: Date | string): string {
  if (typeof value === "string") {
    if (!DATE_RE.test(value)) throw new Error(`날짜 형식이 YYYY-MM-DD가 아닙니다: ${value}`);
    return value;
  }
  return KST.format(value);
}

/**
 * 그 날짜에 효력이 있던 규칙. 없으면 null.
 *
 * null은 "이 날짜에 적용할 확정된 버전이 없다"는 뜻이다. 2026.2.1 이전 건이나
 * 제도 종료(2028.12.31) 이후 건이 여기 해당한다. 가장 가까운 버전으로
 * 대신 계산하지 않는다.
 */
export function rulesFor(shippedOn: Date | string): RuleSet | null {
  const date = toKstDate(shippedOn);
  let found: RuleSet | null = null;
  for (const ruleSet of RULE_SETS) {
    if (date >= ruleSet.effectiveFrom && date <= ruleSet.effectiveTo) {
      // 나중에 시행된 것이 이긴다. 8.1 이후 건은 2026.08을 쓴다.
      found = ruleSet;
    }
  }
  return found;
}

/** fee_calc.calc_version에 저장된 문자열로 당시 규칙을 다시 꺼낸다. */
export function rulesForVersion(version: string): RuleSet | null {
  return RULE_SETS.find((r) => r.version === version) ?? null;
}
