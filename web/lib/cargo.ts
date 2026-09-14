// 품목 코드와 한글 표기.
//
// 코드는 docs/01-SPEC.md의 shipment.cargo_type 그대로다.
// 여기에는 요율이 없다. 무엇을 실었는지만 적는다.

export const CARGO_TYPES = ["CONTAINER_20", "CONTAINER_40", "CEMENT", "ETC"] as const;
export type CargoType = (typeof CARGO_TYPES)[number];

export const CARGO_LABEL: Record<CargoType, string> = {
  CONTAINER_20: "수출입 컨테이너 20FT",
  CONTAINER_40: "수출입 컨테이너 40FT",
  CEMENT: "시멘트",
  ETC: "기타",
};

export function isCargoType(value: string): value is CargoType {
  return (CARGO_TYPES as readonly string[]).includes(value);
}

/**
 * 엑셀에서 온 자유 문자열을 품목 코드로 맞춘다.
 *
 * 현장에서 "40피트", "40'", "40ft", "컨40" 같은 표기가 섞여 들어온다.
 * 못 알아보면 ETC로 떨어뜨리지 않고 null을 돌려준다 — 조용히 틀린 품목이
 * 들어가는 것보다 사용자가 고치는 쪽이 낫다.
 */
export function parseCargoType(raw: string): CargoType | null {
  const text = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!text) return null;
  if (isCargoType(raw.trim().toUpperCase())) return raw.trim().toUpperCase() as CargoType;

  if (/시멘|cement/.test(text)) return "CEMENT";
  if (/기타|etc|기타화물/.test(text)) return "ETC";

  const twenty = /20(ft|피트|')?|이십피트/.test(text);
  const forty = /40(ft|피트|')?|사십피트/.test(text);
  if (forty) return "CONTAINER_40";
  if (twenty) return "CONTAINER_20";

  return null;
}
