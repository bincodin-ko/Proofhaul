// 계산 규칙 인터페이스.
//
// 원문 미대조 — docs/02-RULES-v2026.md B절 참조.
//
// 규칙의 "모양"은 지금 만들고 "숫자"는 비워둔다. 국토교통부 고시 원문을 확보하면
// rules/v2026-*.ts의 null만 실제 값으로 바꾼다. 앱 코드는 건드리지 않는다
// (docs/06-FAST-TRACK.md "핵심 아이디어").
//
// null은 "미확정"이다. 0이 아니다. 화면과 PDF는 null을 받으면 "미지원"을 띄우고
// 값을 지어내지 않는다. 이게 이 계획의 안전장치다.

export type CargoType = "CONTAINER_20" | "CONTAINER_40" | "CEMENT" | "ETC";

/** 분. 대기료 기산 기준 등 시간 단위. */
export type Minutes = number;

/** 원. */
export type Amount = number;

/** 비율. 1.0이 변동 없음. */
export type Ratio = number;

/**
 * 할증 계산에 들어가는 사실들.
 *
 * 여기 있는 항목은 docs/02-RULES-v2026.md **A절**(2차 자료에서 근거 문장을 확인한 항목)에서
 * 왔다. 그래도 원문 대조 전이므로, Phase B에서 이 모양 자체가 바뀔 수 있다.
 * 숫자는 하나도 없다 — 무엇을 보는지만 적혀 있다.
 */
export interface SurchargeFacts {
  /** 냉동·냉장 화물인가 */
  refrigerated?: boolean;
  /** 운수사업자가 발전기 부착 샤시를 제공했는가 (가동 여부와 무관하게 적용) */
  generatorChassisProvided?: boolean;
  /** 상·하행 공(空)컨테이너인가 — 적용 제외 대상 */
  emptyContainer?: boolean;
  /** 복화인가 (컨테이너: 왕복 모두 적재 / 시멘트: 동일 화주 동일 구간) */
  roundTrip?: boolean;
  /** 중량. 선하증권(B/L) 기재 중량 우선, 없으면 계근 중량 */
  weightKg?: number | null;
  /** 확인서에 기록된 대기 시간. 기산 기준이 미확정이라 여기서 판단하지 않는다 */
  recordedWaitMinutes?: Minutes | null;
}

export interface SurchargeInput {
  cargo: CargoType;
  /** 운송 일자 (KST 기준 YYYY-MM-DD). 어느 버전을 쓸지 고르는 근거이기도 하다. */
  shippedOn: string;
  facts: SurchargeFacts;
}

/**
 * 한 시점의 규칙 묶음.
 *
 * 모든 함수가 null을 돌려줄 수 있다. 호출부는 null을 반드시 "미지원"으로 다뤄야 한다.
 */
export interface RuleSet {
  /** 예: "2026.02", "2026.08" — 적용 고시/개정 시점. fee_calc.calc_version에 그대로 들어간다. */
  readonly version: string;
  /** 이 버전이 효력을 갖는 기간 (KST, YYYY-MM-DD, 양 끝 포함). */
  readonly effectiveFrom: string;
  readonly effectiveTo: string;

  /** 대기료 기산 기준. 규격별로 몇 분 초과부터인가. */
  waitThreshold(cargo: CargoType): Minutes | null;
  /** 할증을 포함한 금액. */
  surcharge(input: SurchargeInput): Amount | null;
  /** 유가 연동 반영분. */
  fuelAdjustment(date: Date): Ratio | null;
}

/** null(미확정)인지 확인한다. 호출부에서 0으로 떨어뜨리지 않기 위한 것. */
export function isUnsupported<T>(value: T | null): value is null {
  return value === null;
}

/**
 * 확정된 값만 꺼낸다. 미확정이면 예외를 던진다.
 *
 * `?? 0`을 쓰고 싶어질 때 이걸 쓴다. 0으로 떨어뜨리면 틀린 금액이 조용히 나가고,
 * 예외를 던지면 최소한 터진다. 화면에서는 예외를 부르지 말고 isUnsupported로
 * 분기해서 "미지원"을 띄워야 한다.
 */
export function requireSupported<T>(value: T | null, what: string): T {
  if (value === null) {
    throw new Error(`${what}: 원문 대조가 끝나지 않아 계산할 수 없습니다 (미지원).`);
  }
  return value;
}
