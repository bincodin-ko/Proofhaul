// 만들어진 PDF를 다시 열어 글자를 꺼내 본다.
//
// 화면이 맞는지와 PDF가 맞는지는 다른 문제다. 항목 이름·시각 표기·근거 조항이
// 서식대로 찍혔는지는 파일을 열어봐야만 알 수 있다.
//
// 한계: 글자 추출이 된다고 글리프가 보이는 것은 아니다. pdf-lib의 서브셋터는
// 한글 합성 글리프를 망가뜨리면서도 추출은 멀쩡하게 남긴다(lib/pdf.ts 주석 참조).
// 그래서 폰트를 통째로 임베드했는지를 파일 크기로 같이 본다.

import { createRequire } from "node:module";
import fs from "node:fs/promises";

const require = createRequire(import.meta.url);
const pdfjsPath = require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
const pdfjs = await import(pdfjsPath);

export async function pdfText(file) {
  const data = new Uint8Array(await fs.readFile(file));
  const task = pdfjs.getDocument({ data, useSystemFonts: false });
  const doc = await task.promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it) => it.str).join("") + "\n";
  }
  await task.destroy();
  // 글자 사이에 들어간 줄바꿈·공백 때문에 부분 문자열 검사가 어긋나는 것을 막는다.
  return out.replace(/\s+/g, " ");
}

export async function pdfBytes(file) {
  return (await fs.stat(file)).size;
}
