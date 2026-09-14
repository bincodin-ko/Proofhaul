// 요청에서 IP 꺼내기.
//
// 프록시 뒤에 있으므로 소켓 주소가 아니라 헤더를 본다. 이 값은 신뢰할 수 없다 —
// 속도 제한의 근거로만 쓰고 권한 판단에는 쓰지 않는다.

import { headers } from "next/headers";

/** inet 칼럼에 들어갈 수 있는 형태만 통과시킨다. 아니면 null. */
function asIp(value: string | undefined | null): string | null {
  if (!value) return null;
  const candidate = value.split(",")[0]?.trim();
  if (!candidate) return null;
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;
  const ipv6 = /^[0-9a-f:]+$/i;
  if (ipv4.test(candidate) || (candidate.includes(":") && ipv6.test(candidate))) return candidate;
  return null;
}

export async function requestIp(): Promise<string | null> {
  const h = await headers();
  return asIp(h.get("x-forwarded-for")) ?? asIp(h.get("x-real-ip"));
}
