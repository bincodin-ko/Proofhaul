// 별지 서식 정의 — 국토교통부고시 제2026-55호를 그대로 옮겼다.
//
// 출처: 「2026년 적용 화물자동차 안전운임 고시」(국토교통부고시 제2026-55호,
//       2026.1.30. 고시 / 2026.2.1. 시행) 별지 제1호~제6호서식
// 원문: docs/원문/2026년_적용_화물자동차_안전운임_고시_전문_국토교통부고시_제2026-55호.pdf
// 대조: 2026-09-19
//
// 항목을 우리가 정하지 않는다. 서식에 있는 항목만 받고, 서식에 없는 항목은 받지 않는다.
// 서식에 없는 칸을 하나라도 더 만들면 현장에서 서명하는 사람이 그만큼 더 망설인다.
//
// 요율·할증률·기준시간 숫자는 여전히 하나도 없다. 원문 대조는 끝났지만
// (docs/02-RULES-v2026.md) 기산 시작이 "화주의 도착요청시간"이라 우리가 추정할 수 없고,
// 정각·잔여분 처리 규정이 고시에 없다. 이 도구는 시각만 기록한다.
//
// 글자 주의: 원문의 ⌜ ⌟ ‧ 는 나눔고딕에 글리프가 없어 PDF에서 빈칸이 된다.
// 각각 「 」 · 로 바꿔 적었다. 의미는 같고 인쇄는 된다.

export type CertId = "WAIT" | "ROUGH_ROAD" | "WASH_SWAP";
export type FormId = "F1" | "F2" | "F3" | "F4" | "F5" | "F6";

export type FieldType = "text" | "tel" | "datetime" | "date" | "textarea" | "checks" | "radio";

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: string[];
  hint?: string;
  wide?: boolean;
}

/** 고시 별지 서식 한 장. */
export interface OfficialForm {
  id: FormId;
  /** 서식 번호. PDF 머리에 그대로 인쇄한다. */
  no: string;
  title: string;
  /** 확인서 본문의 근거 조항. 서명 화면과 PDF에 같이 나간다. */
  basis: string;
  /** 서식 하단의 확인 문구. 원문 그대로. */
  statement: string;
  /** 서식의 "* 참고" 항목. 있는 서식에만 있다. */
  notes?: string[];
  /**
   * 고시가 상대방에게 서명 의무를 지운 서식에만 있다.
   * 험로·오지 확인서(제3호·제5호)에는 의무 조항이 없다. 없는 서식에 같은 문구를 붙이면 거짓말이 된다.
   */
  obligation?: string;
  /** 사업장·차량 정보 칸. 서식마다 항목이 다르다. */
  header: Field[];
  /** 서식 고유 항목(시각, 유형, 손상부위 등). */
  body: Field[];
}

const CITE = "「2026년 적용 화물자동차 안전운임 고시」";

const SITE_NAME: Field = { key: "siteName", label: "출입 사업장 명칭", type: "text", placeholder: "예) ○○물류센터" };
const SITE_TERMINAL: Field = { key: "siteName", label: "출입장소(터미널) 명칭", type: "text", placeholder: "예) 부산신항 HPNT" };
const SITE_LOCATION: Field = { key: "siteLocation", label: "위치", type: "text", placeholder: "예) 부산 강서구 신항남로" };
const CONTAINER_NO: Field = { key: "containerNo", label: "컨테이너번호", type: "text", placeholder: "예) ABCU1234567" };
const VEHICLE_NO: Field = { key: "vehicleNo", label: "차량번호", type: "text", placeholder: "예) 12가3456" };
const DRIVER_NAME: Field = { key: "driverName", label: "차주 성명", type: "text" };
const CARRIER_NAME: Field = { key: "carrierName", label: "운수사 명", type: "text", placeholder: "예) 한빛운수" };
const OCCURRED_AT: Field = { key: "occurredAt", label: "일시", type: "datetime" };

/** 별지 제4호·제6호서식의 시각 3칸. 이름과 순서를 서식에서 바꾸지 않는다. */
const WAIT_TIMES: Field[] = [
  {
    key: "requestedEntryAt",
    label: "입차요청시각 (화주)",
    type: "datetime",
    wide: true,
    hint: "화주가 상·하차지에 입차를 요청한 시각입니다. 대기시간은 이 시각부터 셉니다",
  },
  { key: "entryAt", label: "입차시각", type: "datetime", hint: "상차지 또는 하차지 도착시각" },
  { key: "exitAt", label: "출차시각", type: "datetime", hint: "상·하차 완료 후 운행시작 시각" },
];

const WAIT_NOTES = [
  "입차시각 : 상차지 또는 하차지 도착시각",
  "출차시각 : 상차지 또는 하차지에서 상·하차 완료 후 운행시작 시각",
  "입차요청시각 : 화주가 상·하차지에 입차를 요청한 시각",
];

const WAIT_STATEMENT_TAIL =
  " 관련하여 대기시간 증빙을 위해 위와 같이 사업장에 출입하였음을 확인합니다." +
  " 본 확인서는 현장 입·출입 시스템 등과 상호 보완하여 사용할 수 있습니다.";

const ROUGH_STATEMENT_TAIL =
  " 관련하여 험로·오지 증빙을 위해 위와 같이 운송구간에 험로·오지 구간이 있었음을 확인합니다.";

export const OFFICIAL_FORMS: Record<FormId, OfficialForm> = {
  F1: {
    id: "F1",
    no: "별지 제1호서식",
    title: "컨테이너 세척 확인서",
    basis: "별표 1 18.가.",
    obligation: "차주가 확인서 서명을 요구할 시, 세척을 지시한 자는 서명해야 합니다. (별표 1 18.가.)",
    statement:
      `${CITE} 별표 1 18.가. 관련하여 세척 셔틀운임 증빙을 위해 해당 차량은` +
      " 컨테이너 세척을 위하여 세척장까지 컨테이너를 운송하였음을 확인합니다.",
    header: [SITE_TERMINAL, SITE_LOCATION, CONTAINER_NO, VEHICLE_NO, DRIVER_NAME, CARRIER_NAME],
    body: [OCCURRED_AT],
  },
  F2: {
    id: "F2",
    no: "별지 제2호서식",
    title: "손상컨테이너 교체 확인서",
    basis: "별표 1 18.나.",
    obligation: "차주가 확인서 서명을 요구할 시, 담당자는 서명해야 합니다. (별표 1 18.나.)",
    statement:
      `${CITE} 별표 1 18.나. 관련하여 손상컨테이너 교체 셔틀운임 증빙을 위해 해당 차량은` +
      " 손상컨테이너 교체를 위하여 손상컨테이너 수리장까지 컨테이너를 운송하였음을 확인합니다.",
    header: [SITE_TERMINAL, SITE_LOCATION, CONTAINER_NO, VEHICLE_NO, DRIVER_NAME, CARRIER_NAME],
    body: [
      OCCURRED_AT,
      { key: "damagePart", label: "손상부위", type: "textarea", wide: true, placeholder: "어디가 어떻게 손상되어 있었는지" },
    ],
  },
  F3: {
    id: "F3",
    no: "별지 제3호서식",
    title: "컨테이너 험로·오지 확인서",
    basis: "별표 1 23.아.",
    statement: `${CITE} 별표 1 23.아.${ROUGH_STATEMENT_TAIL}`,
    header: [SITE_NAME, SITE_LOCATION, CONTAINER_NO, VEHICLE_NO, DRIVER_NAME, CARRIER_NAME],
    body: [
      OCCURRED_AT,
      {
        key: "roughType",
        label: "험로·오지 유형",
        type: "checks",
        wide: true,
        options: ["폭 2차로 미만 도로", "비포장, 자갈길 등 불량도로", "급경사 구간", "당사자 간 합의하는 경우"],
      },
    ],
  },
  F4: {
    id: "F4",
    no: "별지 제4호서식",
    title: "컨테이너 대기시간 확인서",
    basis: "별표 1 24.다.",
    statement: `${CITE} 별표 1 24.다.${WAIT_STATEMENT_TAIL}`,
    notes: WAIT_NOTES,
    obligation:
      "상·하차지에서 차주가 이 확인서의 서명을 요구할 시," +
      " 화주는 해당 차량의 입·출입시간에 따라 서명해야 합니다. (별표 1 24.다.)",
    header: [SITE_NAME, SITE_LOCATION, CONTAINER_NO, VEHICLE_NO, DRIVER_NAME, CARRIER_NAME],
    body: WAIT_TIMES,
  },
  F5: {
    id: "F5",
    no: "별지 제5호서식",
    title: "시멘트 험로·오지 확인서",
    basis: "별표 2 13.나.",
    statement: `${CITE} 별표 2 13.나.${ROUGH_STATEMENT_TAIL}`,
    header: [SITE_NAME, SITE_LOCATION, VEHICLE_NO, DRIVER_NAME, CARRIER_NAME],
    body: [
      OCCURRED_AT,
      {
        key: "roughType",
        label: "험로·오지 유형",
        type: "checks",
        wide: true,
        options: [
          "폭 2차로 미만 도로",
          "비포장, 자갈길 등 불량도로",
          "급경사 구간",
          "이동식 사일로가 설치된 현장",
          "건설 현장 (진입로 비포장도로인 경우)",
          "바지선 이용 현장",
          "당사자 간 합의하는 경우",
        ],
      },
    ],
  },
  F6: {
    id: "F6",
    no: "별지 제6호서식",
    title: "시멘트 대기시간 확인서",
    basis: "별표 2 14.나.",
    statement: `${CITE} 별표 2 14.나.${WAIT_STATEMENT_TAIL}`,
    notes: WAIT_NOTES,
    obligation:
      "상·하차지에서 차주가 이 확인서를 요구할 시," +
      " 화주는 해당 차량의 입·출입시간에 따라 서명해야 합니다. (별표 2 14.나.)",
    // 제6호서식에는 컨테이너번호도 운수사 명도 없다. 우리가 채워 넣지 않는다.
    header: [SITE_NAME, SITE_LOCATION, VEHICLE_NO, DRIVER_NAME],
    body: WAIT_TIMES,
  },
};

export interface Variant {
  label: string;
  form: FormId;
}

export interface CertType {
  id: CertId;
  title: string;
  short: string;
  desc: string;
  emoji: string;
  /** 어느 별지 서식을 쓸지 고르는 한 줄. 서식이 품목·작업에 따라 갈린다. */
  pick: { label: string; variants: Variant[] };
  /** 계산이 필요한 자리. 기준이 있어도 우리가 계산하지 않는 자리는 "미지원"으로 인쇄한다. */
  unsupported?: { label: string; reason: string };
}

export const CERT_TYPES: CertType[] = [
  {
    id: "WAIT",
    title: "대기시간 확인서",
    short: "대기시간",
    desc: "입차요청·입차·출차 시각을 적고 서명받습니다",
    emoji: "⏱",
    pick: {
      label: "품목",
      variants: [
        { label: "수출입 컨테이너", form: "F4" },
        { label: "시멘트", form: "F6" },
      ],
    },
    unsupported: {
      label: "초과 대기시간 · 대기료",
      reason:
        "대기시간은 화주의 도착요청시각부터 셉니다. 그 시각을 이 도구가 대신 정할 수 없고," +
        " 정각·잔여분 처리 규정도 고시에 없습니다. 시각만 그대로 기록합니다.",
    },
  },
  {
    id: "ROUGH_ROAD",
    title: "험로·오지 확인서",
    short: "험로·오지",
    desc: "해당하는 도로 유형을 고르고 서명받습니다",
    emoji: "⛰",
    pick: {
      label: "품목",
      variants: [
        { label: "수출입 컨테이너", form: "F3" },
        { label: "시멘트", form: "F5" },
      ],
    },
    unsupported: {
      label: "할증률",
      reason: "할증률과 다른 할증과의 합산 방식은 이 도구가 계산하지 않습니다. 사실만 기록합니다.",
    },
  },
  {
    id: "WASH_SWAP",
    title: "컨테이너 세척 · 손상 교체 확인서",
    short: "세척·손상교체",
    desc: "세척 또는 손상 교체 사실을 적고 서명받습니다",
    emoji: "🧴",
    pick: {
      label: "구분",
      variants: [
        { label: "세척", form: "F1" },
        { label: "손상 교체", form: "F2" },
      ],
    },
    unsupported: {
      label: "셔틀운임",
      reason: "지급 금액과 지급 주체는 이 도구가 계산하지 않습니다. 사실만 기록합니다.",
    },
  },
];

/**
 * 다중 선택 값을 잇는 구분자.
 *
 * 쉼표를 쓰면 안 된다. 고시의 보기 중 "비포장, 자갈길 등 불량도로" 자체에 ", "가 들어 있어서
 * 다시 쪼갤 때 두 개로 갈라지고, 고른 항목이 안 고른 것처럼 인쇄된다.
 */
export const MULTI_SEP = "\n";

export function joinPicked(options: string[]): string {
  return options.join(MULTI_SEP);
}

export function splitPicked(value: string): string[] {
  return value.split(MULTI_SEP).filter(Boolean);
}

export function getCert(id: CertId): CertType {
  const found = CERT_TYPES.find((c) => c.id === id);
  if (!found) throw new Error(`unknown cert type: ${id}`);
  return found;
}

/** 선택한 구분에 해당하는 별지 서식. 고르지 않았으면 첫 번째를 쓴다. */
export function resolveForm(cert: CertType, variantLabel: string): OfficialForm {
  const hit = cert.pick.variants.find((v) => v.label === variantLabel) ?? cert.pick.variants[0];
  if (!hit) throw new Error(`cert has no variants: ${cert.id}`);
  return OFFICIAL_FORMS[hit.form];
}

export function formFields(form: OfficialForm): Field[] {
  return [...form.header, ...form.body];
}

/** 확인자 칸. 서식에는 소속과 성명, 서명만 있다. */
export const CONFIRMER_FIELDS: Field[] = [
  { key: "confirmerOrg", label: "소속", type: "text", placeholder: "예) ○○물류 부산지점" },
  { key: "confirmerName", label: "성명", type: "text", placeholder: "서명하시는 분 이름" },
];

/** PDF 하단과 화면에 같이 붙는 고지. 이 도구의 한계를 문서 안에 남긴다. */
export const DISCLAIMER =
  "이 문서는 고시 별지 서식의 기재 항목을 그대로 옮겨 만든 비공식 도구의 출력물입니다." +
  " 안전운임 요율·할증·초과시간 계산은 포함되어 있지 않습니다.";
