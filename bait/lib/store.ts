// 이 폰 안에만 남는 저장소.
//
// 서버로 아무것도 보내지 않는다는 약속은 그대로다. 그래서 저장소도 브라우저 안이다.
// 대신 지켜야 할 것이 두 가지 있다.
//
//   1. 사용자가 저장된다는 사실을 알아야 하고, 한 번에 지울 수 있어야 한다
//   2. 저장이 막혀 있어도(시크릿 모드, 저장소 차단) 도구는 그대로 돌아가야 한다
//
// 두 번째가 중요하다. 현장에서 쓰는 도구가 "저장할 수 없습니다"로 멈추면 안 된다.
// 모든 읽기·쓰기는 실패해도 조용히 넘어간다.

import type { CertId, FormId } from "./certs";

const ME_KEY = "bait.me.v1";
const DOCS_KEY = "bait.docs.v1";

/** 목록이 무한정 자라지 않게 한다. 넘치면 오래된 것부터 버린다. */
const MAX_DOCS = 60;

/** 매번 다시 적지 않아도 되는 값들. 확인서마다 바뀌지 않는 것만 기억한다. */
export interface Me {
  vehicleNo?: string;
  driverName?: string;
  carrierName?: string;
}

/** 기억할 항목. 사업장·시각처럼 건마다 달라지는 값은 넣지 않는다. */
export const REMEMBERED_KEYS = ["vehicleNo", "driverName", "carrierName"] as const;

export type DocStatus =
  /** 현장에서 바로 서명받아 PDF까지 만든 것 */
  | "SIGNED"
  /** 링크로 서명을 요청했고, 아직 서명된 PDF를 못 받은 것 */
  | "REQUESTED"
  /** 링크로 요청했다가 서명된 PDF를 받았다고 사용자가 표시한 것 */
  | "RECEIVED";

export interface DocRecord {
  id: string;
  certId: CertId;
  formId: FormId;
  variant: string;
  values: Record<string, string>;
  status: DocStatus;
  /** 만든 시각 (ISO). 목록 정렬과 표시에만 쓴다. */
  createdAt: string;
  confirmerOrg?: string;
  confirmerName?: string;
  /** 현장 서명분만 갖는다. 링크 요청분은 서명이 이 폰에 없다. */
  signaturePng?: string;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 용량 초과·저장소 차단. 저장을 못 해도 도구는 돌아간다 */
  }
}

export function loadMe(): Me {
  const me = readJson<Me>(ME_KEY, {});
  return typeof me === "object" && me !== null ? me : {};
}

/** 확인서를 만들 때마다 갱신한다. 빈 값은 기존 값을 지우지 않는다. */
export function rememberMe(values: Record<string, string>): void {
  const me = loadMe();
  let changed = false;
  for (const key of REMEMBERED_KEYS) {
    const value = (values[key] ?? "").trim();
    if (value && me[key] !== value) {
      me[key] = value;
      changed = true;
    }
  }
  if (changed) writeJson(ME_KEY, me);
}

export function loadDocs(): DocRecord[] {
  const docs = readJson<DocRecord[]>(DOCS_KEY, []);
  if (!Array.isArray(docs)) return [];
  return docs.filter((d) => d && typeof d.id === "string");
}

/**
 * 하나 저장한다. 같은 id가 있으면 덮어쓴다.
 *
 * 서명 이미지 때문에 용량이 찰 수 있다. 넘치면 오래된 것의 서명부터 버리고,
 * 그래도 안 되면 오래된 항목 자체를 버린다. 새 기록을 못 남기는 쪽이 더 나쁘다.
 */
export function saveDoc(record: DocRecord): void {
  let docs = [record, ...loadDocs().filter((d) => d.id !== record.id)].slice(0, MAX_DOCS);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      window.localStorage.setItem(DOCS_KEY, JSON.stringify(docs));
      return;
    } catch {
      const keepSignature = Math.max(1, Math.floor(docs.length / 2));
      const trimmed = docs.map((d, i) => (i < keepSignature ? d : { ...d, signaturePng: undefined }));
      docs = JSON.stringify(trimmed) === JSON.stringify(docs) ? docs.slice(0, Math.ceil(docs.length / 2)) : trimmed;
      if (docs.length === 0) return;
    }
  }
}

export function updateDocStatus(id: string, status: DocStatus): void {
  const docs = loadDocs().map((d) => (d.id === id ? { ...d, status } : d));
  writeJson(DOCS_KEY, docs);
}

export function removeDoc(id: string): void {
  writeJson(DOCS_KEY, loadDocs().filter((d) => d.id !== id));
}

/** 이 폰에 남은 것을 전부 지운다. 화면에서 한 번에 닿을 수 있어야 한다. */
export function clearAll(): void {
  for (const key of [ME_KEY, DOCS_KEY]) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* 무시 */
    }
  }
}

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
