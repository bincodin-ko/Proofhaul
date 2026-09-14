// 운송 건 읽고 쓰기.
//
// 전부 withCompany를 거친다. 회사 조건은 RLS가 강제하므로 WHERE에 company_id를
// 다시 적지 않는다 — 적으면 "여기만 적었나" 하는 착각이 생긴다.

import { withCompany } from "../db/tenant";
import type { CargoType } from "./cargo";
import type { ShipmentDraft } from "./paste";

export interface Shipment {
  id: string;
  cargo_type: CargoType;
  origin: string | null;
  destination: string | null;
  shipped_on: string;
  driver_name: string | null;
  driver_phone: string | null;
  shipper_name: string | null;
  memo: string | null;
  created_at: Date;
  evidence_count: number;
}

const COLUMNS = `
  s.id, s.cargo_type, s.origin, s.destination,
  to_char(s.shipped_on, 'YYYY-MM-DD') AS shipped_on,
  s.driver_name, s.driver_phone, s.shipper_name, s.memo, s.created_at,
  (SELECT count(*) FROM evidence e WHERE e.shipment_id = s.id)::int AS evidence_count
`;

export async function listShipments(companyId: string, limit = 100): Promise<Shipment[]> {
  return withCompany(companyId, (sql) =>
    sql<Shipment>(
      `SELECT ${COLUMNS} FROM shipment s ORDER BY s.shipped_on DESC, s.created_at DESC LIMIT $1`,
      [limit],
    ),
  );
}

export async function getShipment(companyId: string, id: string): Promise<Shipment | null> {
  const rows = await withCompany(companyId, (sql) =>
    sql<Shipment>(`SELECT ${COLUMNS} FROM shipment s WHERE s.id = $1`, [id]),
  );
  return rows[0] ?? null;
}

/** 빈 문자열은 NULL로 넣는다. ''와 NULL이 섞이면 나중에 조회 조건이 지저분해진다. */
function nullIfBlank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function createShipment(companyId: string, draft: ShipmentDraft): Promise<string> {
  const rows = await withCompany(companyId, (sql) =>
    sql<{ id: string }>(
      `INSERT INTO shipment
         (company_id, shipped_on, cargo_type, origin, destination,
          driver_name, driver_phone, shipper_name, memo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        companyId,
        draft.shipped_on,
        draft.cargo_type,
        nullIfBlank(draft.origin),
        nullIfBlank(draft.destination),
        nullIfBlank(draft.driver_name),
        nullIfBlank(draft.driver_phone),
        nullIfBlank(draft.shipper_name),
        nullIfBlank(draft.memo),
      ],
    ),
  );
  return rows[0]!.id;
}

/**
 * 여러 건을 한 트랜잭션에서 넣는다.
 *
 * 한 줄이라도 DB에서 거부되면 전부 되돌린다. 500줄 중 300줄만 들어간 상태로
 * 끝나면 무엇이 들어갔는지 사용자가 알 수 없다. 읽을 수 없는 줄은 여기 오기 전에
 * (lib/paste.ts) 걸러진다.
 */
export async function createShipments(
  companyId: string,
  drafts: ShipmentDraft[],
): Promise<string[]> {
  if (drafts.length === 0) return [];

  return withCompany(companyId, async (sql) => {
    const rows = await sql<{ id: string }>(
      `INSERT INTO shipment
         (company_id, shipped_on, cargo_type, origin, destination,
          driver_name, driver_phone, shipper_name, memo)
       SELECT $1,
              d.shipped_on::date, d.cargo_type,
              nullif(btrim(d.origin), ''), nullif(btrim(d.destination), ''),
              nullif(btrim(d.driver_name), ''), nullif(btrim(d.driver_phone), ''),
              nullif(btrim(d.shipper_name), ''), nullif(btrim(d.memo), '')
       FROM unnest($2::text[], $3::text[], $4::text[], $5::text[],
                   $6::text[], $7::text[], $8::text[], $9::text[])
            AS d(shipped_on, cargo_type, origin, destination,
                 driver_name, driver_phone, shipper_name, memo)
       RETURNING id`,
      [
        companyId,
        drafts.map((d) => d.shipped_on),
        drafts.map((d) => d.cargo_type),
        drafts.map((d) => d.origin),
        drafts.map((d) => d.destination),
        drafts.map((d) => d.driver_name),
        drafts.map((d) => d.driver_phone),
        drafts.map((d) => d.shipper_name),
        drafts.map((d) => d.memo),
      ],
    );
    return rows.map((r) => r.id);
  });
}
