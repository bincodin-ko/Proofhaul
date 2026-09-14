// 엑셀 붙여넣기 파싱.
//
// 이 업종은 엑셀에서 온다. 붙여넣기가 안 되면 안 쓴다 (docs/01-SPEC.md 화면 1).
//
// 엑셀에서 셀 범위를 복사하면 클립보드에 TSV(탭 구분)가 들어간다. 셀 안에 탭이나
// 줄바꿈이 있으면 그 셀만 큰따옴표로 감싸고, 안의 큰따옴표는 둘로 겹친다.
// 이 파일은 DOM도 DB도 건드리지 않는 순수 함수만 둔다 — 그래야 테스트할 수 있다.

import { CARGO_LABEL, parseCargoType, type CargoType } from "./cargo";

// 05-SECURITY 위협 5: "붙여넣기 입력도 길이·행수 상한을 둔다".
export const MAX_PASTE_BYTES = 512 * 1024;
export const MAX_ROWS = 500;
export const MAX_COLUMNS = 40;

export const FIELDS = [
  "shipped_on",
  "cargo_type",
  "origin",
  "destination",
  "driver_name",
  "driver_phone",
  "shipper_name",
  "memo",
] as const;
export type Field = (typeof FIELDS)[number];

export const FIELD_LABEL: Record<Field, string> = {
  shipped_on: "운송 일자",
  cargo_type: "품목",
  origin: "출발지",
  destination: "도착지",
  driver_name: "차주 성명",
  driver_phone: "차주 연락처",
  shipper_name: "화주",
  memo: "메모",
};

/** 저장에 반드시 있어야 하는 것. 나머지는 비어 있어도 된다. */
export const REQUIRED_FIELDS: readonly Field[] = ["shipped_on", "cargo_type"];

/** 헤더 글자에서 칼럼을 추정할 때 쓰는 단서. 앞에 있는 것이 먼저 잡힌다. */
const HEADER_HINTS: ReadonlyArray<[Field, RegExp]> = [
  ["shipped_on", /운송\s*(일자|날짜)|상차일|일자|날짜|date/i],
  ["cargo_type", /품목|화물|규격|컨테이너|cargo/i],
  ["origin", /출발|상차|기점|from|origin/i],
  ["destination", /도착|하차|착지|to|dest/i],
  ["driver_phone", /연락처|전화|휴대|핸드폰|phone|tel/i],
  ["driver_name", /차주|기사|운전/i],
  ["shipper_name", /화주|거래처|현장|shipper/i],
  ["memo", /메모|비고|note|memo/i],
];

export interface ParsedGrid {
  rows: string[][];
  /** 첫 줄이 헤더로 보이는가. 사용자가 화면에서 뒤집을 수 있다. */
  looksLikeHeader: boolean;
  /** 칼럼별 추정 필드. 못 정하면 null(가져오지 않음). */
  mapping: (Field | null)[];
  /** 상한에 걸려 잘렸으면 알려준다. 조용히 버리지 않는다. */
  truncated: { rows: number } | null;
}

/** TSV 한 덩어리를 격자로 자른다. 큰따옴표로 감싼 셀 안의 탭·줄바꿈을 지킨다. */
export function parseGrid(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === "\t") {
      endCell();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") {
      endRow();
    } else {
      cell += ch;
    }
  }

  if (cell !== "" || row.length > 0) endRow();

  // 엑셀에서 복사하면 마지막에 빈 줄이 따라오는 일이 흔하다.
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c.trim() === "")) rows.pop();
  return rows;
}

function guessHeader(row: string[]): boolean {
  const cells = row.map((c) => c.trim()).filter(Boolean);
  if (cells.length === 0) return false;
  // 날짜처럼 보이는 칸이 있으면 헤더가 아니라 데이터다.
  if (cells.some((c) => parseShippedOn(c) !== null)) return false;
  const hits = cells.filter((c) => HEADER_HINTS.some(([, re]) => re.test(c))).length;
  return hits >= Math.min(2, cells.length);
}

function guessMapping(header: string[], sample: string[] | undefined): (Field | null)[] {
  const used = new Set<Field>();
  return header.map((cell, index) => {
    const text = cell.trim();
    for (const [field, re] of HEADER_HINTS) {
      if (!used.has(field) && text && re.test(text)) {
        used.add(field);
        return field;
      }
    }
    // 헤더 글자로 못 정하면 값의 생김새로 한 번 더 본다.
    const value = sample?.[index]?.trim() ?? "";
    if (value) {
      if (!used.has("shipped_on") && parseShippedOn(value)) {
        used.add("shipped_on");
        return "shipped_on";
      }
      if (!used.has("driver_phone") && /^[\d\s\-+()]{9,}$/.test(value)) {
        used.add("driver_phone");
        return "driver_phone";
      }
      if (!used.has("cargo_type") && parseCargoType(value)) {
        used.add("cargo_type");
        return "cargo_type";
      }
    }
    return null;
  });
}

export function parsePaste(text: string): ParsedGrid {
  // 브라우저에서도 도는 코드다. Buffer를 쓰지 않는다.
  if (new TextEncoder().encode(text).length > MAX_PASTE_BYTES) {
    throw new Error("붙여넣은 내용이 너무 큽니다. 나눠서 올려주세요.");
  }

  let rows = parseGrid(text);
  let truncated: ParsedGrid["truncated"] = null;
  if (rows.length > MAX_ROWS) {
    truncated = { rows: rows.length - MAX_ROWS };
    rows = rows.slice(0, MAX_ROWS);
  }
  rows = rows.map((r) => r.slice(0, MAX_COLUMNS));

  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  rows = rows.map((r) => (r.length === width ? r : [...r, ...Array(width - r.length).fill("")]));

  const first = rows[0];
  const looksLikeHeader = first ? guessHeader(first) : false;
  const header = looksLikeHeader && first ? first : Array(width).fill("");
  const sample = looksLikeHeader ? rows[1] : rows[0];

  return { rows, looksLikeHeader, mapping: guessMapping(header, sample), truncated };
}

// ── 값 해석 ────────────────────────────────────────────────────────────────

const YEAR_FIRST = /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/;

/**
 * 날짜를 YYYY-MM-DD로. 못 읽으면 null.
 *
 * 연도 없는 "8/15"는 받지 않는다. 올해로 짐작해서 넣으면 연말에 한 해가 통째로
 * 어긋난다. 사용자가 고치게 하는 쪽이 낫다.
 */
export function parseShippedOn(raw: string): string | null {
  const text = raw.trim();
  const match = YEAR_FIRST.exec(text);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // 실제로 있는 날짜인지 (2026-02-30 같은 것)
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** 연락처 정리. 한국 휴대폰 형태면 하이픈을 맞추고, 아니면 적힌 그대로 둔다. */
export function normalizePhone(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  if (/^01\d{8,9}$/.test(digits)) {
    return `${digits.slice(0, 3)}-${digits.slice(3, -4)}-${digits.slice(-4)}`;
  }
  return text;
}

export interface ShipmentDraft {
  shipped_on: string;
  cargo_type: CargoType;
  origin: string;
  destination: string;
  driver_name: string;
  driver_phone: string;
  shipper_name: string;
  memo: string;
}

export interface RowResult {
  /** 원본에서 몇 번째 줄이었는지 (1부터). 오류를 짚어줄 때 쓴다. */
  lineNumber: number;
  draft: ShipmentDraft | null;
  errors: string[];
}

const MAX_TEXT = 500;

function trimField(value: string): string {
  return value.trim().slice(0, MAX_TEXT);
}

/** 격자 + 칼럼 매핑 → 저장할 초안. 줄마다 따로 판정한다. */
export function toDrafts(
  rows: string[][],
  mapping: (Field | null)[],
  hasHeader: boolean,
): RowResult[] {
  const body = hasHeader ? rows.slice(1) : rows;
  const offset = hasHeader ? 2 : 1;

  const mapped = new Set(mapping.filter((f): f is Field => f !== null));
  const missing = REQUIRED_FIELDS.filter((f) => !mapped.has(f));

  return body.map((row, index) => {
    const lineNumber = index + offset;
    const errors: string[] = [];

    // 통째로 빈 줄은 오류가 아니라 그냥 건너뛴다.
    if (row.every((c) => c.trim() === "")) {
      return { lineNumber, draft: null, errors: [] };
    }

    for (const field of missing) {
      errors.push(`${FIELD_LABEL[field]} 칼럼이 지정되지 않았습니다.`);
    }

    const pick = (field: Field): string => {
      const index = mapping.indexOf(field);
      return index >= 0 ? (row[index] ?? "") : "";
    };

    const shippedOn = parseShippedOn(pick("shipped_on"));
    if (!shippedOn && !missing.includes("shipped_on")) {
      const raw = pick("shipped_on").trim();
      errors.push(
        raw
          ? `운송 일자를 읽지 못했습니다: "${raw}" (예: 2026-08-15)`
          : "운송 일자가 비어 있습니다.",
      );
    }

    const cargoType = parseCargoType(pick("cargo_type"));
    if (!cargoType && !missing.includes("cargo_type")) {
      const raw = pick("cargo_type").trim();
      errors.push(
        raw
          ? `품목을 알아보지 못했습니다: "${raw}" (${Object.values(CARGO_LABEL).join(" / ")})`
          : "품목이 비어 있습니다.",
      );
    }

    if (errors.length > 0 || !shippedOn || !cargoType) {
      return { lineNumber, draft: null, errors };
    }

    return {
      lineNumber,
      draft: {
        shipped_on: shippedOn,
        cargo_type: cargoType,
        origin: trimField(pick("origin")),
        destination: trimField(pick("destination")),
        driver_name: trimField(pick("driver_name")),
        driver_phone: normalizePhone(pick("driver_phone")).slice(0, MAX_TEXT),
        shipper_name: trimField(pick("shipper_name")),
        memo: trimField(pick("memo")),
      },
      errors: [],
    };
  });
}
