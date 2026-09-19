// PDF 생성 — 전부 브라우저 안에서 한다.
//
// 서버로 입력값을 보내지 않는 것이 이 도구의 약속이라, 서버 렌더를 쓸 수 없다.
// 그래서 pdf-lib로 클라이언트에서 만들고, 한글 폰트를 직접 임베드한다.
// 폰트를 임베드하지 않으면 표준 14 폰트에는 한글 글리프가 없어서 전부 깨진다.

import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { CertType, DISCLAIMER, Field, OfficialForm, splitPicked } from "./certs";

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
  /** 어느 별지 서식으로 인쇄할지. 항목과 문구가 전부 여기서 나온다. */
  form: OfficialForm;
  values: Record<string, string>;
  confirmerOrg: string;
  confirmerName: string;
  signaturePng: string;
  createdAt: Date;
}

/**
 * datetime-local 값("2026-03-04T14:02")을 서식의 표기로 바꾼다.
 * 서식은 "2026년 __월 __일 __시 __분" 칸이다. 빈 값은 빈 문자열로 둔다.
 */
export function formatFormDateTime(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) return raw.trim();
  const [, y, mo, d, h, mi] = m;
  return `${y}년 ${Number(mo)}월 ${Number(d)}일 ${h}시 ${mi}분`;
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

/** 서식에 인쇄된 항목명을 그대로 쓴다. 우리가 줄이지 않는다. */
function label(field: Field) {
  return field.label.replace(/ \(/, "(");
}

/** 항목 값을 서식 표기로 바꾼다. 체크 항목은 아래 renderChecks가 따로 그린다. */
function displayValue(field: Field, raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (field.type === "datetime") return formatFormDateTime(value);
  return value;
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

  pdf.setTitle(doc.form.title);
  pdf.setProducer("안전운임 확인서 생성기");
  pdf.setCreator("안전운임 확인서 생성기");
  pdf.setCreationDate(doc.createdAt);

  const c = new Cursor(pdf, font);
  const form = doc.form;

  // 서식 머리 — 실제 별지 서식과 같은 줄을 같은 자리에 둔다.
  c.text(`\u25a0 2026년 적용 화물자동차 안전운임 고시 [${form.no}]`, { size: 8.5, color: MUTED });
  c.y -= 24;

  const titleSize = 19;
  const titleW = font.widthOfTextAtSize(form.title, titleSize);
  c.text(form.title, { x: (A4.w - titleW) / 2, size: titleSize, bold: true });
  c.y -= 16;
  c.rule(INK);
  c.y -= 24;

  const row = (name: string, value: string) => {
    const filled = value.length > 0;
    const lines = wrap(filled ? value : "(미기재)", font, 10, c.width - LABEL_W);
    c.need(lines.length * 15 + 6);
    c.text(name, { size: 9.5, color: MUTED });
    lines.forEach((line, i) => {
      c.page.drawText(line, {
        x: MARGIN + LABEL_W, y: c.y, size: 10, font, color: filled ? INK : MUTED,
      });
      if (i < lines.length - 1) c.y -= 15;
    });
    c.y -= 21;
  };

  // 체크 항목은 서식처럼 보기를 전부 인쇄하고 고른 것만 채운다.
  // 고른 것만 인쇄하면 무엇을 고르지 않았는지가 사라진다.
  const checks = (field: Field, picked: string[]) => {
    const options = field.options ?? [];
    c.need(options.length * 14 + 10);
    c.text(label(field), { size: 9.5, color: MUTED });
    options.forEach((option, i) => {
      const mark = picked.includes(option) ? "\u25a0" : "\u25a1";
      c.page.drawText(`${mark} ${option}`, {
        x: MARGIN + LABEL_W, y: c.y, size: 10, font, color: INK,
      });
      if (i < options.length - 1) c.y -= 14;
    });
    c.y -= 20;
  };

  for (const field of [...form.header, ...form.body]) {
    const raw = doc.values[field.key] ?? "";
    if (field.type === "checks" || field.type === "radio") {
      checks(field, splitPicked(raw));
    } else {
      row(label(field), displayValue(field, raw));
    }
  }

  // 확인 문구 — 고시 서식의 문장 그대로. 우리가 고쳐 쓰지 않는다.
  c.y -= 2;
  c.rule();
  c.y -= 18;
  for (const line of wrap(form.statement, font, 9, c.width)) {
    c.need(14);
    c.text(line, { size: 9 });
    c.y -= 13;
  }

  if (form.notes?.length) {
    c.y -= 6;
    c.need(16 + form.notes.length * 12);
    c.text("* 참고", { size: 8.5, color: MUTED });
    c.y -= 13;
    for (const note of form.notes) {
      c.text(note, { x: MARGIN + 10, size: 8.5, color: MUTED });
      c.y -= 12;
    }
  }
  c.y -= 12;

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

  c.y -= 4;
  row("작성일", formatFormDate(doc.createdAt));
  row("확인자 소속", doc.confirmerOrg);
  row("확인자 성명", doc.confirmerName);

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
  c.page.drawText("(서명 또는 인)", {
    x: A4.w - MARGIN - 16 - font.widthOfTextAtSize("(서명 또는 인)", 8.5),
    y: c.y - sigH + 10, size: 8.5, font, color: MUTED,
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

/** 서식의 작성일 칸은 "2026년 __월 __일"이다. */
export function formatFormDate(d: Date): string {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function fileNameFor(doc: CertDoc): string {
  // 파일명의 날짜는 입차시각(없으면 일시, 그것도 없으면 만든 날)에서 가져온다.
  const source = (doc.values.entryAt || doc.values.occurredAt || "").trim();
  const date = source.slice(0, 10) || doc.createdAt.toISOString().slice(0, 10);
  const who = (doc.values.vehicleNo || "").trim().replace(/[\\/:*?"<>|\s]/g, "");
  return [doc.form.title.replace(/\s/g, ""), date, who].filter(Boolean).join("_") + ".pdf";
}
