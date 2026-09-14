// 증빙 토큰 — 05-SECURITY "위협 1".
//
// 이 파일이 지켜야 하는 것들:
//  - CSPRNG 32바이트, DB에는 해시만, 상수 시간 비교, 만료 7일
//  - 토큰 1개 = 증빙 1건. 운송 건 전체나 회사에 접근시키지 않는다
//  - 없는 토큰과 만료된 토큰의 응답을 구분할 수 없게
//  - 토큰 조회에 IP 속도 제한
//  - 서명 완료 후 같은 토큰으로 수정 불가

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { withoutCompany } from "../db/tenant";
import type { CargoType } from "./cargo";
import type { EvidenceKind } from "./evidence-kind";

export const TOKEN_TTL_DAYS = 7;

/**
 * 05-SECURITY: "토큰 조회에 IP 기준 속도 제한 (분당 10회 수준)".
 *
 * 실패와 전체를 나눠서 센다. 전부 한 통에 세면 정상 서명자가 화면을 몇 번
 * 새로고침하는 것만으로 잠기는데, 서명이 막히는 것은 이 제품에서 가장 나쁜 일이다.
 * 막으려는 열거 공격은 실패로 나타나므로 실패를 좁게 막고 전체는 넉넉히 둔다.
 */
const LOOKUP_LIMIT = { window: "1 minute", maxFailures: 10, maxTotal: 60 } as const;

export function issueToken(): { token: string; hash: Buffer } {
  // crypto.randomBytes = CSPRNG. Math.random()이나 타임스탬프 기반은 쓰지 않는다.
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function expiresAt(from = new Date()): Date {
  return new Date(from.getTime() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** 서명 전 화면에 띄워도 되는 것만. 여기 없는 값은 서명자에게 나가지 않는다. */
export interface SigningView {
  evidenceId: string;
  companyId: string;
  kind: EvidenceKind;
  shipmentId: string;
  shippedOn: string;
  cargoType: CargoType;
  companyName: string;
}

export type TokenResult =
  | { state: "ok"; view: SigningView }
  /** 없거나 만료됨. 두 경우를 부르는 쪽에서도 구분할 수 없다. */
  | { state: "gone" }
  | { state: "signed" }
  | { state: "throttled" };

interface EvidenceRow {
  evidence_id: string;
  company_id: string;
  kind: EvidenceKind;
  status: string;
  token_hash: Buffer;
  expires_at: Date;
  signed_at: Date | null;
  shipment_id: string;
  shipped_on: string;
  cargo_type: CargoType;
  company_name: string;
}

/** 토큰 하나로 증빙 한 건을 찾는다. */
export async function lookupByToken(token: string, ip: string | null): Promise<TokenResult> {
  if (!token || token.length > 128) return { state: "gone" };

  const lookups = await withoutCompany((sql) =>
    sql<{ total: string; failures: string }>(
      "SELECT * FROM token_recent_lookups($1, $2::interval)",
      [ip, LOOKUP_LIMIT.window],
    ),
  );
  const recent = lookups[0];
  if (
    Number(recent?.failures ?? 0) >= LOOKUP_LIMIT.maxFailures ||
    Number(recent?.total ?? 0) >= LOOKUP_LIMIT.maxTotal
  ) {
    return { state: "throttled" };
  }

  const hash = hashToken(token);
  const rows = await withoutCompany((sql) =>
    sql<EvidenceRow>(
      "SELECT * FROM evidence_by_token_hash($1::bytea)",
      [hash],
    ),
  );
  const row = rows[0];

  await withoutCompany((sql) => sql("SELECT token_note_lookup($1, $2)", [ip, Boolean(row)]));

  if (!row) return { state: "gone" };

  // 조회 자체가 해시 일치로 이루어지지만, 요구사항대로 상수 시간 비교를 한 번 더 한다.
  // 길이가 다르면 timingSafeEqual이 예외를 던지므로 길이부터 맞춘다.
  const stored = Buffer.from(row.token_hash);
  if (stored.length !== hash.length || !timingSafeEqual(stored, hash)) return { state: "gone" };

  // 만료된 토큰은 없는 토큰과 똑같이 답한다. 어떤 정보도 보여주지 않는다.
  if (row.expires_at.getTime() <= Date.now()) return { state: "gone" };
  if (row.status !== "REQUESTED" || row.signed_at) return { state: "signed" };

  return {
    state: "ok",
    view: {
      evidenceId: row.evidence_id,
      companyId: row.company_id,
      kind: row.kind,
      shipmentId: row.shipment_id,
      shippedOn: String(row.shipped_on).slice(0, 10),
      cargoType: row.cargo_type,
      companyName: row.company_name,
    },
  };
}

export interface SignInput {
  token: string;
  signerName: string;
  signerRole: "SHIPPER" | "DRIVER";
  payload: Record<string, string>;
  signaturePath: string;
  ip: string | null;
  userAgent: string | null;
}

/**
 * 서명을 저장한다.
 *
 * 갱신 조건(REQUESTED + 미만료)이 DB 함수 안에 있다. 이미 서명됐거나 만료된
 * 토큰이면 0행이 갱신되고 여기서 false가 된다 — 서명 완료 후 같은 토큰으로
 * 수정하는 경로가 없다.
 */
export async function signWithToken(input: SignInput): Promise<{ evidenceId: string } | null> {
  const rows = await withoutCompany((sql) =>
    sql<{ evidence_id: string }>(
      "SELECT * FROM evidence_sign($1::bytea, $2, $3, $4::jsonb, $5, $6, $7)",
      [
        hashToken(input.token),
        input.signerName,
        input.signerRole,
        JSON.stringify(input.payload),
        input.signaturePath,
        input.ip,
        input.userAgent,
      ],
    ),
  );
  const row = rows[0];
  return row ? { evidenceId: row.evidence_id } : null;
}
