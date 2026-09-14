// 증빙 종류와 종류별 입력 항목.
//
// 여기에도 숫자가 없다. 기준 시간·할증률은 원문 대조 전이다
// (docs/02-RULES-v2026.md B절). 이 화면은 사실을 적고 서명받는 데까지다.

export const EVIDENCE_KINDS = ["WAIT", "ROUGH_ROAD", "WASH_SWAP", "RECEIPT", "ETC"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export function isEvidenceKind(value: string): value is EvidenceKind {
  return (EVIDENCE_KINDS as readonly string[]).includes(value);
}

export interface KindField {
  key: string;
  label: string;
  type: "time" | "text" | "textarea" | "checks";
  options?: string[];
  placeholder?: string;
  hint?: string;
}

export interface KindSpec {
  id: EvidenceKind;
  title: string;
  short: string;
  desc: string;
  fields: KindField[];
}

export const KINDS: Record<EvidenceKind, KindSpec> = {
  WAIT: {
    id: "WAIT",
    title: "대기시간 확인서",
    short: "대기시간",
    desc: "현장 도착·상차·하차 시각을 적고 서명받습니다",
    fields: [
      { key: "arrivedAt", label: "현장 도착 시각", type: "time" },
      { key: "loadStartAt", label: "상차 시작 시각", type: "time" },
      { key: "unloadStartAt", label: "하차 시작 시각", type: "time" },
      { key: "leftAt", label: "현장 출발 시각", type: "time" },
      {
        key: "note",
        label: "비고",
        type: "textarea",
        placeholder: "날짜가 바뀐 시각이 있으면 적어주세요",
      },
    ],
  },
  ROUGH_ROAD: {
    id: "ROUGH_ROAD",
    title: "험로 · 오지 확인서",
    short: "험로·오지",
    desc: "운행한 구간과 도로 상태를 적고 서명받습니다",
    fields: [
      { key: "sectionFrom", label: "구간 시작 지점", type: "text" },
      { key: "sectionTo", label: "구간 종료 지점", type: "text" },
      {
        key: "roadCondition",
        label: "도로 상태 (해당 항목 전부)",
        type: "checks",
        options: ["비포장", "급경사", "협소 도로", "산간 · 오지", "공사 구간", "기타"],
      },
      { key: "detail", label: "구간 상세", type: "textarea" },
    ],
  },
  WASH_SWAP: {
    id: "WASH_SWAP",
    title: "컨테이너 세척 · 손상 교체 확인서",
    short: "세척·손상교체",
    desc: "세척 또는 손상 교체 사실을 적고 서명받습니다",
    fields: [
      { key: "kind", label: "구분", type: "checks", options: ["세척", "손상 교체"] },
      { key: "containerNo", label: "컨테이너 번호", type: "text" },
      { key: "place", label: "작업 장소", type: "text" },
      { key: "workedAt", label: "작업 시각", type: "time" },
      { key: "reason", label: "사유 / 손상 내용", type: "textarea" },
    ],
  },
  RECEIPT: {
    id: "RECEIPT",
    title: "인수증",
    short: "인수증",
    desc: "화물을 받았음을 확인하고 서명받습니다",
    fields: [
      { key: "receivedAt", label: "인수 시각", type: "time" },
      { key: "condition", label: "화물 상태", type: "textarea", placeholder: "이상이 있으면 적어주세요" },
    ],
  },
  ETC: {
    id: "ETC",
    title: "기타 확인서",
    short: "기타",
    desc: "위에 없는 내용을 적고 서명받습니다",
    fields: [{ key: "detail", label: "내용", type: "textarea" }],
  },
};

/** 요청 쪽에서 고를 수 있는 종류. */
export const REQUESTABLE: EvidenceKind[] = ["WAIT", "ROUGH_ROAD", "WASH_SWAP", "RECEIPT", "ETC"];

export const SIGNER_ROLES = [
  { value: "SHIPPER", label: "화주 담당자" },
  { value: "DRIVER", label: "차주" },
] as const;

export function isSignerRole(value: string): value is "SHIPPER" | "DRIVER" {
  return value === "SHIPPER" || value === "DRIVER";
}

const MAX_TEXT = 500;

/**
 * 서명 화면에서 온 값을 종류에 정의된 항목만 남기고 다듬는다.
 *
 * 폼은 사용자가 고쳐 보낼 수 있다. 모르는 키는 버리고, 길이는 자른다.
 */
export function cleanPayload(kind: EvidenceKind, raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of KINDS[kind].fields) {
    const value = raw[field.key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim().slice(0, MAX_TEXT);
    if (trimmed) out[field.key] = trimmed;
  }
  return out;
}
