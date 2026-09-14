// 2026.2.1 시행분.
//
// 출처 문서: 「2026년 적용 화물자동차 안전운임 고시」(국토교통부, 2026.1.30 고시)
//            「2026년도 적용 화물자동차 안전운임 운영지침」(국토교통부)
// 확인 날짜: (미대조)
//
// **원문 미대조 — docs/02-RULES-v2026.md B절 참조.**
//
// 모든 함수가 null을 돌려준다. 일부러 그렇다. 대기료 기산 기준, 할증 적용 방식,
// 개별 부대비용 금액은 전부 원문에서 근거 문장을 찾지 못한 항목이다. 추정값이나
// 임시값을 넣지 않는다 — 임시값은 반드시 잊어버린다 (02-RULES "코드 반영 규칙" 2항).
//
// 원문을 확보하면 이 파일의 null만 바꾼다. 함수 위에 근거 조항과 확인 날짜를
// 주석으로 남긴다 (06-FAST-TRACK B2).

import type { Amount, CargoType, Minutes, Ratio, RuleSet, SurchargeInput } from "./types";

export const v2026_02: RuleSet = {
  version: "2026.02",

  // 2026.1.30 고시로 확정, 2026.2.1 ~ 12.31 효력 (02-RULES "확인된 사실").
  // 2026.8.1 유가 연동 개정이 있어 실제로는 7.31까지만 이 버전을 쓴다 — rules/index.ts 참조.
  effectiveFrom: "2026-02-01",
  effectiveTo: "2026-12-31",

  // 미대조: 컨테이너 규격별 기산 기준 시간, 기산점(도착 시각인지 접수 시각인지),
  //         초과분 계산 단위 — 02-RULES B절
  waitThreshold(_cargo: CargoType): Minutes | null {
    return null;
  },

  // 미대조: 가산 방식의 구체적 계산, 시멘트 상한 적용 지점, 냉동·냉장 할증,
  //         개별 부대비용 금액 — 02-RULES A절·B절
  surcharge(_input: SurchargeInput): Amount | null {
    return null;
  },

  // 미대조: 이 버전은 유가 연동 반영 이전이다. 반영폭과 적용 시점 모두 원문 확인 필요
  fuelAdjustment(_date: Date): Ratio | null {
    return null;
  },
};
