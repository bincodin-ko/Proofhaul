// 증빙 요청 쪽 (운송사, 로그인 상태).

import { withCompany } from "../db/tenant";
import type { EvidenceKind } from "./evidence-kind";
import { expiresAt, issueToken } from "./token";

export interface EvidenceRow {
  id: string;
  kind: EvidenceKind;
  status: "REQUESTED" | "SIGNED" | "EXPIRED";
  requested_at: Date;
  signed_at: Date | null;
  expires_at: Date;
  signer_name: string | null;
}

/** 화면에 보일 상태. 만료는 시각으로 판정한다 — 배치가 늦게 돌아도 맞아야 한다. */
export type DisplayStatus = "REQUESTED" | "SIGNED" | "EXPIRED";

export function displayStatus(row: EvidenceRow, now = new Date()): DisplayStatus {
  if (row.status === "SIGNED") return "SIGNED";
  if (row.expires_at.getTime() <= now.getTime()) return "EXPIRED";
  return "REQUESTED";
}

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  REQUESTED: "요청됨",
  SIGNED: "서명됨",
  EXPIRED: "만료",
};

export async function listEvidence(companyId: string, shipmentId: string): Promise<EvidenceRow[]> {
  return withCompany(companyId, (sql) =>
    sql<EvidenceRow>(
      `SELECT id, kind, status, requested_at, signed_at, expires_at, signer_name
       FROM evidence WHERE shipment_id = $1 ORDER BY requested_at DESC`,
      [shipmentId],
    ),
  );
}

export interface IssuedRequest {
  evidenceId: string;
  /** 원문 토큰. DB에는 해시만 남으므로 이 값은 여기서만 볼 수 있다. */
  token: string;
  expiresAt: Date;
}

/**
 * 증빙 요청 1건 = 토큰 1개.
 *
 * shipment_id가 이 회사 것인지는 따로 확인하지 않는다. 복합 외래키
 * (shipment_id, company_id)가 남의 운송 건을 거부하고, RLS가 애초에 남의
 * shipment를 보여주지 않는다.
 */
export async function createEvidenceRequest(
  companyId: string,
  shipmentId: string,
  kind: EvidenceKind,
): Promise<IssuedRequest> {
  const { token, hash } = issueToken();
  const expires = expiresAt();

  const rows = await withCompany(companyId, (sql) =>
    sql<{ id: string }>(
      `INSERT INTO evidence (shipment_id, company_id, kind, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [shipmentId, companyId, kind, hash, expires],
    ),
  );

  return { evidenceId: rows[0]!.id, token, expiresAt: expires };
}
