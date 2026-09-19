// 익명 카운터.
//
// 관찰하려는 건 네 가지뿐이다: 몇 번 만들어졌나, 어떤 확인서가 많나, 다시 왔나,
// 그리고 현장에서 바로 받았나 링크로 받았나.
//
// 마지막 하나가 이번 실험의 핵심 질문이다. 링크를 아무도 안 쓰면 원격 서명은
// 필요 없던 기능이고, 링크만 쓰면 현장 서명이 환상이었다는 뜻이다.
//
// 그 이상은 보내지 않는다. 입력값·이름·연락처·서명은 브라우저 밖으로 나가지 않는다.

import type { CertId } from "./certs";

const VISIT_KEY = "bait.visits";
const MADE_KEY = "bait.made";

function readInt(key: string): number {
  try {
    return Number.parseInt(window.localStorage.getItem(key) ?? "0", 10) || 0;
  } catch {
    return 0; // 시크릿 모드나 저장소 차단. 세는 걸 못해도 도구는 돌아가야 한다.
  }
}

function writeInt(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* 무시 */
  }
}

/** 방문 기록. 재방문 여부 판정에만 쓴다. */
export function markVisit(): { revisit: boolean } {
  const visits = readInt(VISIT_KEY) + 1;
  writeInt(VISIT_KEY, visits);
  return { revisit: visits > 1 };
}

export function madeCount(): number {
  return readInt(MADE_KEY);
}

/**
 * 어떤 경로로 일어난 일인지.
 *
 * here    — 이 폰에서 바로 서명받아 PDF까지 만들었다
 * request — 링크로 서명을 요청했다 (아직 서명은 안 됨)
 * link    — 링크를 받은 쪽이 서명해서 PDF를 만들었다
 */
export type Via = "here" | "request" | "link";

/** PDF를 실제로 내려받았을 때(또는 링크를 만들었을 때)만 센다. 폼을 열어본 것은 세지 않는다. */
export function countGenerated(kind: CertId, via: Via = "here") {
  const made = readInt(MADE_KEY) + 1;
  writeInt(MADE_KEY, made);
  const body = JSON.stringify({
    kind,
    // 정확한 횟수 대신 구간만 보낸다. 개인을 좁히는 데 쓸 수 없게.
    repeat: made === 1 ? "first" : made <= 3 ? "2-3" : "4+",
    via,
  });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/count", new Blob([body], { type: "application/json" }));
      return;
    }
  } catch {
    /* 아래로 */
  }
  void fetch("/api/count", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    /* 카운터가 죽어도 사용자는 몰라야 한다 */
  });
}
