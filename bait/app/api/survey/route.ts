// 설문 수신구. 카운터와 같은 원칙이다 — 허용 목록에 없는 값은 기록하지 않는다.
//
// 주관식이 없으므로 여기로 들어올 수 있는 값은 lib/survey.ts에 적힌 보기뿐이다.
// 그래도 한 번 더 거른다. 링크는 누구나 두드릴 수 있다.

import { NextResponse } from "next/server";
import { SURVEYS, type SurveySet } from "@/lib/survey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETS = new Set<string>(["maker", "signer"]);

function allowed(set: SurveySet): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const q of SURVEYS[set]) out[q.id] = new Set(q.options.map((o) => o.value));
  return out;
}

export async function POST(request: Request) {
  let set: unknown;
  let answers: unknown;
  try {
    const body = await request.json();
    set = body?.set;
    answers = body?.answers;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  if (typeof set !== "string" || !SETS.has(set)) return new NextResponse(null, { status: 204 });
  if (typeof answers !== "object" || answers === null) return new NextResponse(null, { status: 204 });

  const schema = allowed(set as SurveySet);
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(answers as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    if (!schema[key]?.has(value)) continue;
    clean[key] = value;
  }
  // 하나도 유효하지 않으면 기록할 것이 없다.
  if (Object.keys(clean).length === 0) return new NextResponse(null, { status: 204 });

  const event = { evt: "survey", set, ...clean };
  console.log(JSON.stringify(event));

  const webhook = process.env.COUNTER_WEBHOOK_URL;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      /* 설문 실패는 사용자와 무관하다 */
    }
  }

  return new NextResponse(null, { status: 204 });
}
