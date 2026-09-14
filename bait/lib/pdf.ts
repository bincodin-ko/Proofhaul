// PDF 생성 — 전부 브라우저 안에서 한다.
//
// 서버로 입력값을 보내지 않는 것이 이 도구의 약속이라, 서버 렌더를 쓸 수 없다.
// 그래서 pdf-lib로 클라이언트에서 만들고, 한글 폰트를 직접 임베드한다.
// 폰트를 임베드하지 않으면 표준 14 폰트에는 한글 글리프가 없어서 전부 깨진다.

import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { CertType, COMMON_FIELDS, DISCLAIMER, Field } from "./certs";

const FONT_URL = "/fonts/NanumGothic-Regular.ttf";

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 48;
const LABEL_W = 116;
const INK = rgb(0.12, 0.12, 0.13);
const MUTED = rgb(0.42, 0.44, 0.47);
const LINE = rgb(0.84, 0.85, 0.87);
const BOX = rgb(0.97, 0.97, 0.98);

let fontBytesPromise: Promise<ArrayBuffer> | null = null;

/** 폰트는 2MB다. PDF를 만들 때만 받고, 한 번 받으면 재사용한다. */
export function loadFontBytes(): Promise<ArrayBuffer> {
  if (!fontBytesPromise) {
    fontBytesPromise = fetch(FONT_URL).then((res) => {
      if (!res.ok) throw new Error(`폰트를 불러오지 못했습니다 (${res.status})`);
      return res.arrayBuffer();
    });
    // 실패한 약속을 캐시에 남기면 다시 시도할 수 없다.
    fontBytesPromise.catch(() => {
      fontBytesPromise = null;
    });
  }
  return fontBytesPromise;
}

export interface CertDoc {
  cert: CertType;
  common: Record<string, string>;
  detail: Record<string, string>;
  signerName: string;
  signerRole: string;
  signaturePng: string;
  createdAt: Date;
}

/**
 * 한글은 어절 단위로 끊지 않아도 읽히지만 영문은 단어가 잘리면 읽기 나쁘다.
 * CJK는 글자 단위로, 라틴은 단어 단위로 토큰을 만들어 섞어 쓴다.
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let buf = "";
  const isCjk = (ch: string) => /[ᄀ-ᇿ　-〿㄰-㆏가-힣＀-￯]/.test(ch);
  for (const ch of text) {
    if (isCjk(ch)) {
      if (buf) { tokens.push(buf); buf = ""; }
      tokens.push(ch);
    } else if (ch === " ") {
      if (buf) { tokens.push(buf); buf = ""; }
      tokens.push(" ");
    } else {
      buf += ch;
    }
  }
  if (buf) tokens.push(buf);
  return tokens;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) { lines.push(""); continue; }
    let line = "";
    for (const token of tokenize(paragraph)) {
      const next = line + token;
      if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
        lines.push(line.trimEnd());
        line = token === " " ? "" : token;
      } else {
        line = next;
      }
    }
    if (line.trim()) lines.push(line.trimEnd());
  }
  return lines.length ? lines : [""];
}

class Cursor {
  page: PDFPage;
  y: number;
  constructor(private doc: PDFDocument, private font: PDFFont) {
    this.page = doc.addPage([A4.w, A4.h]);
    this.y = A4.h - MARGIN;
  }
  get width() { return A4.w - MARGIN * 2; }
  /** 남은 높이가 모자라면 다음 장으로 넘긴다. */
  need(h: number) {
    if (this.y - h < MARGIN + 24) {
      this.page = this.doc.addPage([A4.w, A4.h]);
      this.y = A4.h - MARGIN;
    }
  }
  text(s: string, opts: { x?: number; size?: number; color?: typeof INK; bold?: boolean } = {}) {
    const size = opts.size ?? 10;
    const x = opts.x ?? MARGIN;
    this.page.drawText(s, { x, y: this.y, size, font: this.font, color: opts.color ?? INK });
    // 굵은 자족이 없어서 같은 글자를 아주 조금 밀어 한 번 더 그린다.
    if (opts.bold) {
      this.page.drawText(s, { x: x + 0.35, y: this.y, size, font: this.font, color: opts.color ?? INK });
    }
  }
  rule(color = LINE) {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: A4.w - MARGIN, y: this.y },
      thickness: 0.7,
      color,
    });
  }
}

function label(field: Field) {
  return field.label.replace(/ \(.*\)$/, "");
}

function collect(fields: Field[], values: Record<string, string>) {
  return fields
    .map((f) => ({ field: f, value: (values[f.key] ?? "").trim() }))
    .filter((row) => row.value.length > 0);
}

export async function buildCertPdf(doc: CertDoc): Promise<Blob> {
  const fontBytes = await loadFontBytes();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // subset: false — 일부러 그렇다.
  //
  // pdf-lib(fontkit)의 TrueType 서브셋터는 합성 글리프(composite glyph)를 제대로
  // 옮기지 못한다. 나눔고딕의 한글 음절은 대부분 자모를 조합한 합성 글리프라,
  // subset: true로 만들면 PDF 안의 글자가 통째로 빈칸이 된다. 텍스트 추출은
  // 멀쩡해서 눈으로 열어보기 전까지 알아채기 어렵다.
  //
  // 값: PDF 한 장이 약 750KB가 된다. 글자가 사라지는 것보다 낫다.
  const font = await pdf.embedFont(fontBytes, { subset: false });

  pdf.setTitle(doc.cert.title);
  pdf.setProducer("안전운임 확인서 생성기");
  pdf.setCreator("안전운임 확인서 생성기");
  pdf.setCreationDate(doc.createdAt);

  const c = new Cursor(pdf, font);

  // 제목
  c.y -= 14;
  const titleSize = 19;
  const titleW = font.widthOfTextAtSize(doc.cert.title, titleSize);
  c.text(doc.cert.title, { x: (A4.w - titleW) / 2, size: titleSize, bold: true });
  c.y -= 16;
  c.rule(INK);
  c.y -= 26;

  const section = (heading: string) => {
    c.need(46);
    c.text(heading, { size: 11, bold: true });
    c.y -= 8;
    c.rule();
    c.y -= 16;
  };

  const row = (name: string, value: string) => {
    const valueW = c.width - LABEL_W;
    const lines = wrap(value, font, 10, valueW);
    c.need(lines.length * 15 + 6);
    c.text(name, { size: 9.5, color: MUTED });
    lines.forEach((line, i) => {
      c.page.drawText(line, { x: MARGIN + LABEL_W, y: c.y, size: 10, font, color: INK });
      if (i < lines.length - 1) c.y -= 15;
    });
    c.y -= 21;
  };

  section("운송 건 정보");
  for (const { field, value } of collect(COMMON_FIELDS, doc.common)) row(label(field), value);

  c.y -= 8;
  section("확인 사항");
  const detailRows = collect(doc.cert.fields, doc.detail);
  if (detailRows.length === 0) {
    row("내용", "기재 없음");
  } else {
    for (const { field, value } of detailRows) row(label(field), value);
  }

  // 계산하지 않은 자리를 빈칸이나 0으로 두지 않는다. "미지원"이라고 인쇄한다.
  if (doc.cert.unsupported) {
    const reasonLines = wrap(doc.cert.unsupported.reason, font, 8.5, c.width - 28);
    const boxH = 30 + reasonLines.length * 12;
    c.need(boxH + 12);
    c.y -= 4;
    c.page.drawRectangle({
      x: MARGIN, y: c.y - boxH + 12, width: c.width, height: boxH,
      color: BOX, borderColor: LINE, borderWidth: 0.7,
    });
    c.y -= 6;
    c.text(`${doc.cert.unsupported.label} : 미지원`, { x: MARGIN + 14, size: 9.5, bold: true });
    c.y -= 14;
    for (const line of reasonLines) {
      c.text(line, { x: MARGIN + 14, size: 8.5, color: MUTED });
      c.y -= 12;
    }
    c.y -= 14;
  }

  c.y -= 8;
  section("서명");
  row("서명자", `${doc.signerName} (${doc.signerRole})`);
  row("서명 시각", formatStamp(doc.createdAt));

  const sigH = 88;
  c.need(sigH + 20);
  const png = await pdf.embedPng(doc.signaturePng);
  const scale = Math.min(220 / png.width, sigH / png.height);
  c.page.drawRectangle({
    x: MARGIN, y: c.y - sigH, width: c.width, height: sigH,
    borderColor: LINE, borderWidth: 0.7,
  });
  c.page.drawImage(png, {
    x: MARGIN + 16,
    y: c.y - sigH + (sigH - png.height * scale) / 2,
    width: png.width * scale,
    height: png.height * scale,
  });
  c.y -= sigH + 24;

  // 꼬리말 — 마지막 장 아래에 고정
  const last = pdf.getPages()[pdf.getPageCount() - 1];
  last.drawLine({
    start: { x: MARGIN, y: MARGIN + 30 }, end: { x: A4.w - MARGIN, y: MARGIN + 30 },
    thickness: 0.7, color: LINE,
  });
  wrap(DISCLAIMER, font, 8, A4.w - MARGIN * 2).forEach((line, i) => {
    last.drawText(line, { x: MARGIN, y: MARGIN + 18 - i * 10, size: 8, font, color: MUTED });
  });

  const bytes = await pdf.save();
  return new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
}

export function formatStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fileNameFor(doc: CertDoc): string {
  const date = (doc.common.shippedOn || "").trim() || doc.createdAt.toISOString().slice(0, 10);
  const who = (doc.common.vehicleNo || "").trim().replace(/[\\/:*?"<>|\s]/g, "");
  return [doc.cert.title.replace(/\s/g, ""), date, who].filter(Boolean).join("_") + ".pdf";
}
