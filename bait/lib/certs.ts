// 확인서 종류와 입력 항목 정의.
//
// 여기에는 요율·할증률·기준시간 같은 숫자가 하나도 없다. 일부러 그렇다.
// 국토교통부 고시 원문 대조가 끝나지 않았고(docs/02-RULES-v2026.md B절),
// 추정값을 넣는 순간 이 도구는 틀린 값을 퍼뜨리는 도구가 된다.
//
// 이 도구가 하는 일은 "있었던 사실을 적고 서명받는 것"까지다.

export type CertId = "WAIT" | "ROUGH_ROAD" | "WASH_SWAP";

export type FieldType = "text" | "tel" | "time" | "date" | "textarea" | "checks" | "radio";

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: string[];
  hint?: string;
  wide?: boolean;
}

export interface CertType {
  id: CertId;
  title: string;
  short: string;
  desc: string;
  emoji: string;
  fields: Field[];
  /** 계산이 필요한 자리. 기준이 확정되기 전까지 화면과 PDF 모두 "미지원"으로 인쇄한다. */
  unsupported?: { label: string; reason: string };
}

/** 세 종류가 공통으로 쓰는 운송 건 정보. */
export const COMMON_FIELDS: Field[] = [
  { key: "shippedOn", label: "운송 일자", type: "date" },
  { key: "carrierName", label: "운송사", type: "text", placeholder: "예) 한빛운수" },
  { key: "shipperName", label: "화주 / 현장", type: "text", placeholder: "예) ○○물류센터" },
  { key: "vehicleNo", label: "차량번호", type: "text", placeholder: "예) 12가3456" },
  { key: "driverName", label: "차주 성명", type: "text" },
  { key: "cargoType", label: "품목", type: "radio", wide: true, options: ["수출입 컨테이너 20FT", "수출입 컨테이너 40FT", "시멘트", "기타"] },
  { key: "origin", label: "출발지", type: "text" },
  { key: "destination", label: "도착지", type: "text" },
];

export const CERT_TYPES: CertType[] = [
  {
    id: "WAIT",
    title: "대기시간 확인서",
    short: "대기시간",
    desc: "현장 도착·상차·하차 시각을 적고 서명받습니다",
    emoji: "⏱",
    fields: [
      { key: "arrivedAt", label: "현장 도착 시각", type: "time" },
      { key: "loadStartAt", label: "상차 시작 시각", type: "time" },
      { key: "unloadStartAt", label: "하차 시작 시각", type: "time" },
      { key: "leftAt", label: "현장 출발 시각", type: "time" },
      {
        key: "timeNote",
        label: "비고",
        type: "textarea",
        wide: true,
        placeholder: "날짜가 바뀐 시각이 있으면 여기에 적어주세요. 예) 하차 시작은 익일",
      },
    ],
    unsupported: {
      label: "초과 대기시간 · 청구 가능 여부",
      reason: "기산 기준이 고시 원문과 대조되지 않아 계산하지 않습니다. 시각만 기록합니다",
    },
  },
  {
    id: "ROUGH_ROAD",
    title: "험로 · 오지 확인서",
    short: "험로·오지",
    desc: "운행한 구간과 도로 상태를 적고 서명받습니다",
    emoji: "⛰",
    fields: [
      { key: "sectionFrom", label: "구간 시작 지점", type: "text", placeholder: "예) 국도 ○○호선 ○○삼거리" },
      { key: "sectionTo", label: "구간 종료 지점", type: "text" },
      {
        key: "roadCondition",
        label: "도로 상태 (해당 항목 전부)",
        type: "checks",
        wide: true,
        options: ["비포장", "급경사", "협소 도로", "산간 · 오지", "공사 구간", "기타"],
      },
      { key: "sectionDetail", label: "구간 상세", type: "textarea", wide: true, placeholder: "거리, 소요 시간, 우회 여부 등" },
    ],
    unsupported: {
      label: "할증 적용 구간 여부 · 할증률",
      reason: "기준 구간 정의와 할증률이 고시 원문과 대조되지 않아 판정하지 않습니다",
    },
  },
  {
    id: "WASH_SWAP",
    title: "컨테이너 세척 · 손상 교체 확인서",
    short: "세척·손상교체",
    desc: "세척 또는 손상 교체 사실을 적고 서명받습니다",
    emoji: "🧴",
    fields: [
      { key: "kind", label: "구분", type: "checks", wide: true, options: ["세척", "손상 교체"] },
      { key: "containerNo", label: "컨테이너 번호", type: "text", placeholder: "예) ABCU1234567" },
      { key: "place", label: "작업 장소", type: "text" },
      { key: "workedAt", label: "작업 시각", type: "time" },
      { key: "reason", label: "사유 / 손상 내용", type: "textarea", wide: true, placeholder: "무엇이 어떻게 되어 있었는지" },
      { key: "swapContainerNo", label: "교체 후 컨테이너 번호", type: "text", hint: "손상 교체인 경우에만" },
    ],
    unsupported: {
      label: "세척 · 교체 비용",
      reason: "발급 요건과 금액이 고시 원문과 대조되지 않아 계산하지 않습니다",
    },
  },
];

export function getCert(id: CertId): CertType {
  const found = CERT_TYPES.find((c) => c.id === id);
  if (!found) throw new Error(`unknown cert type: ${id}`);
  return found;
}

export const SIGNER_ROLES = ["화주 담당자", "운송사", "차주", "기타"] as const;

/** PDF 하단과 화면에 같이 붙는 고지. 이 도구의 한계를 문서 안에 남긴다. */
export const DISCLAIMER =
  "이 문서는 비공식 도구로 작성된 사실 확인용 서식입니다. 안전운임 요율·할증·초과시간 계산은 포함되어 있지 않습니다.";
