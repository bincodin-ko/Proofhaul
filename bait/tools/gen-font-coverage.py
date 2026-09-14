#!/usr/bin/env python3
"""lib/font-coverage.ts를 다시 만든다.

PDF에 임베드하는 폰트의 cmap을 그대로 코드포인트 구간 표로 옮긴다.
폰트를 교체하면 반드시 다시 돌릴 것.

    pip install fonttools
    python3 tools/gen-font-coverage.py public/fonts/NanumGothic-Regular.ttf
"""
import pathlib
import sys

from fontTools.ttLib import TTFont

HEADER = """// 자동 생성 — 손으로 고치지 마라.
// 생성: tools/gen-font-coverage.py  (%s의 cmap)
//
// PDF에 임베드하는 폰트에 글리프가 없는 글자는 조용히 빈칸으로 인쇄된다.
// 서명까지 받은 문서에서 글자가 사라지는 건 최악이라, 만들기 전에 막는다.

/** [시작] 또는 [시작, 끝] 형태의 코드포인트 구간. */
const RANGES: ReadonlyArray<readonly [number, number?]> = [%s];

export const COVERED_CODEPOINTS = %d;

function covered(cp: number): boolean {
  let lo = 0;
  let hi = RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end = start] = RANGES[mid];
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return true;
  }
  return false;
}

/** 폰트가 그릴 수 없는 글자를 중복 없이 순서대로 돌려준다. */
export function unprintable(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    // 줄바꿈·탭은 글리프가 없어도 정상이다.
    if (cp === 0x0a || cp === 0x0d || cp === 0x09) continue;
    if (covered(cp)) continue;
    if (seen.has(ch)) continue;
    seen.add(ch);
    found.push(ch);
  }
  return found;
}
"""


def main(font_path: str) -> None:
    font = TTFont(font_path, lazy=True)
    codepoints = set()
    for table in font["cmap"].tables:
        codepoints |= set(table.cmap.keys())
    font.close()

    ordered = sorted(codepoints)
    ranges = []
    start = prev = ordered[0]
    for cp in ordered[1:]:
        if cp == prev + 1:
            prev = cp
            continue
        ranges.append((start, prev))
        start = prev = cp
    ranges.append((start, prev))

    body = ",".join(f"[{a},{b}]" if a != b else f"[{a}]" for a, b in ranges)
    out = pathlib.Path(__file__).resolve().parent.parent / "lib" / "font-coverage.ts"
    out.write_text(HEADER % (font_path, body, len(ordered)), encoding="utf-8")
    print(f"{out}: {len(ordered)} codepoints in {len(ranges)} ranges")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "public/fonts/NanumGothic-Regular.ttf")
