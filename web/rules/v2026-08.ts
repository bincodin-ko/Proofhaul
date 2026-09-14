// 2026.8.1 유가 연동 개정분.
//
// 출처 문서: 2026.8.1 유가 연동 개정 고시 (연중 개정분)
// 확인 날짜: (미대조)
//
// **원문 미대조 — docs/02-RULES-v2026.md B절 참조.**
//
// 이 버전이 존재하는 이유가 제품의 근거다. 7월 건과 8월 건의 계산 기준이 다르고,
// 나중에 분쟁이 나면 그 시점 기준으로 재현해야 한다 (00-PLAN "핵심 근거").
// 과거 건을 최신 규칙으로 덮어쓰면 안 된다.
//
// 지금은 2026.02와 마찬가지로 전부 null이다. 값이 같아서가 아니라 둘 다 미확정이라서다.

import type { Amount, CargoType, Minutes, Ratio, RuleSet, SurchargeInput } from "./types";

export const v2026_08: RuleSet = {
  version: "2026.08",

  // 02-RULES "확인된 사실": 2026.8.1 유가 연동으로 컨테이너 운임 인상.
  effectiveFrom: "2026-08-01",
  effectiveTo: "2026-12-31",

  // 미대조 — 02-RULES B절
  waitThreshold(_cargo: CargoType): Minutes | null {
    return null;
  },

  // 미대조 — 02-RULES A절·B절
  surcharge(_input: SurchargeInput): Amount | null {
    return null;
  },

  // 미대조: 3개월 평균 유가가 ±기준 이상 변동할 때만 반영한다는 구조는 A절에서
  //         확인했으나, 기준값과 반영폭은 원문에서 채운다
  fuelAdjustment(_date: Date): Ratio | null {
    return null;
  },
};
