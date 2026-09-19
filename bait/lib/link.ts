// 서명 요청 링크.
//
// 링크 하나에 확인서 내용을 통째로 담는다. 서버에 저장하지 않는다.
//
// 주소의 `#` 뒤(프래그먼트)는 **브라우저가 서버로 보내지 않는다.** 그래서 내용을
// 거기 싣는다. 우리 서버 로그에도, 접속 기록에도 남지 않는다. DB도 필요 없다.
//
// 대신 링크를 받은 사람은 내용을 볼 수 있다. 종이 확인서를 건네는 것과 같은
// 수준이고, 링크를 보내는 상대가 곧 서명할 사람이므로 그 이상을 숨길 이유가 없다.
// 다만 사용자가 그 사실을 알아야 하므로 링크를 만드는 화면에서 그대로 말한다.
//
// 링크는 누구나 만들어 보낼 수 있다. 그래서 읽는 쪽은 아무것도 믿지 않는다 —
// 서식에 있는 항목 이름만 받고, 길이를 자르고, 제어문자를 버린다.

import { OFFICIAL_FORMS, formFields, type FormId, type OfficialForm } from "./certs";

const PARAM = "r";
const VERSION = 1;

/** 링크 하나가 담을 수 있는 한계. 카톡에서 잘리지 않을 만한 크기로 잡았다. */
const MAX_ENCODED = 4000;
const MAX_VALUE = 300;
const MAX_FROM = 60;

export interface SignRequest {
  form: OfficialForm;
  values: Record<string, string>;
  /** 누가 보냈는지. 받는 사람이 첫 줄에서 알아야 하는 정보다. */
  from: string;
}

interface Payload {
  v: number;
  f: string;
  from?: string;
  d: Record<string, string>;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 줄바꿈은 다중 선택 구분자라 남기고, 나머지 제어문자는 버린다. */
function clean(value: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").slice(0, max).trim();
}

/** 확인서 내용을 프래그먼트 문자열(`#r=...`)로 만든다. */
export function encodeRequest(request: SignRequest): string {
  const fields = formFields(request.form);
  const d: Record<string, string> = {};
  for (const field of fields) {
    const value = clean(request.values[field.key] ?? "", MAX_VALUE);
    if (value) d[field.key] = value;
  }
  const payload: Payload = { v: VERSION, f: request.form.id, d };
  const from = clean(request.from, MAX_FROM);
  if (from) payload.from = from;

  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  if (encoded.length > MAX_ENCODED) {
    throw new Error("내용이 너무 길어 링크로 만들 수 없습니다. 글자 수를 줄여주세요.");
  }
  return `#${PARAM}=${encoded}`;
}

/** 현재 주소에 붙일 전체 링크. */
export function requestUrl(request: SignRequest): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return base + encodeRequest(request);
}

/**
 * 프래그먼트를 다시 확인서로 읽는다. 조금이라도 이상하면 null.
 *
 * 링크는 바깥에서 온 데이터다. 서식에 없는 항목 이름은 통째로 버린다.
 */
export function decodeRequest(hash: string): SignRequest | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const match = new URLSearchParams(raw).get(PARAM);
  if (!match || match.length > MAX_ENCODED) return null;

  let payload: Payload;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(match)));
    if (typeof parsed !== "object" || parsed === null) return null;
    payload = parsed as Payload;
  } catch {
    return null;
  }

  if (payload.v !== VERSION) return null;
  const form = OFFICIAL_FORMS[payload.f as FormId];
  if (!form) return null;

  const allowed = new Set(formFields(form).map((f) => f.key));
  const values: Record<string, string> = {};
  const incoming = payload.d;
  if (typeof incoming !== "object" || incoming === null) return null;
  for (const [key, value] of Object.entries(incoming)) {
    if (!allowed.has(key) || typeof value !== "string") continue;
    const cleaned = clean(value, MAX_VALUE);
    if (cleaned) values[key] = cleaned;
  }

  return { form, values, from: clean(typeof payload.from === "string" ? payload.from : "", MAX_FROM) };
}
