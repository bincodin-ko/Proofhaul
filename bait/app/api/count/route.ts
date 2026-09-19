// 익명 카운터 수신구. DB를 쓰지 않는다 — 서버 로그가 저장소다.
// 로그는 Vercel 대시보드에서 종류별로 세면 되고, 2주 실험에는 그걸로 충분하다.
//
// 받는 값은 확인서 종류와 재사용 구간뿐이다. IP도 UA도 기록하지 않는다.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = new Set(["WAIT", "ROUGH_ROAD", "WASH_SWAP"]);
const REPEATS = new Set(["first", "2-3", "4+"]);
// here = 현장에서 바로 / request = 링크로 요청함 / link = 링크 받은 쪽이 서명함
const VIAS = new Set(["here", "request", "link"]);

export async function POST(request: Request) {
  let kind: unknown;
  let repeat: unknown;
  let via: unknown;
  try {
    const body = await request.json();
    kind = body?.kind;
    repeat = body?.repeat;
    via = body?.via;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  // 허용 목록에 없는 값은 로그에 남기지 않는다. 로그 인젝션과
  // 실수로 흘러들어온 입력값을 동시에 막는다.
  if (typeof kind !== "string" || !KINDS.has(kind)) return new NextResponse(null, { status: 204 });
  const bucket = typeof repeat === "string" && REPEATS.has(repeat) ? repeat : "unknown";
  const path = typeof via === "string" && VIAS.has(via) ? via : "unknown";

  console.log(JSON.stringify({ evt: "cert_generated", kind, repeat: bucket, via: path }));

  const webhook = process.env.COUNTER_WEBHOOK_URL;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evt: "cert_generated", kind, repeat: bucket, via: path }),
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      /* 카운터 실패는 사용자와 무관하다 */
    }
  }

  return new NextResponse(null, { status: 204 });
}
