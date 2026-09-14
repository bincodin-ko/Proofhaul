"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isCargoType } from "@/lib/cargo";
import { requireSession } from "@/lib/guard";
import { MAX_ROWS, parseShippedOn, type ShipmentDraft } from "@/lib/paste";
import { createEvidenceRequest } from "@/lib/evidence";
import { isEvidenceKind } from "@/lib/evidence-kind";
import { createShipment, createShipments, getShipment } from "@/lib/shipments";

export interface FormState {
  message: string | null;
}

export async function createShipmentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireSession();

  const get = (key: string) => String(formData.get(key) ?? "").trim();

  const shippedOn = parseShippedOn(get("shipped_on"));
  if (!shippedOn) return { message: "운송 일자를 확인해 주세요." };

  const cargoType = get("cargo_type");
  if (!isCargoType(cargoType)) return { message: "품목을 골라 주세요." };

  const draft: ShipmentDraft = {
    shipped_on: shippedOn,
    cargo_type: cargoType,
    origin: get("origin"),
    destination: get("destination"),
    driver_name: get("driver_name"),
    driver_phone: get("driver_phone"),
    shipper_name: get("shipper_name"),
    memo: get("memo"),
  };

  const id = await createShipment(session.companyId, draft);
  revalidatePath("/shipments");
  // 저장하자마자 증빙 요청으로 이어지게 상세로 보낸다 (01-SPEC 화면 1).
  redirect(`/shipments/${id}?new=1`);
}

export interface ImportResult {
  message: string | null;
  imported: number;
}

/**
 * 붙여넣기로 들어온 여러 건을 저장한다.
 *
 * 화면에서 이미 걸러진 초안만 온다고 가정하지 않는다. 서버에서 한 번 더 본다 —
 * 폼은 사용자가 고쳐 보낼 수 있다.
 */
export async function importShipmentsAction(drafts: ShipmentDraft[]): Promise<ImportResult> {
  const session = await requireSession();

  if (!Array.isArray(drafts) || drafts.length === 0) {
    return { message: "가져올 줄이 없습니다.", imported: 0 };
  }
  if (drafts.length > MAX_ROWS) {
    return { message: `한 번에 ${MAX_ROWS}건까지 가져올 수 있습니다.`, imported: 0 };
  }

  const clean: ShipmentDraft[] = [];
  for (const draft of drafts) {
    const shippedOn = parseShippedOn(String(draft?.shipped_on ?? ""));
    const cargoType = String(draft?.cargo_type ?? "");
    if (!shippedOn || !isCargoType(cargoType)) {
      return { message: "읽을 수 없는 줄이 섞여 있습니다. 화면에서 다시 확인해 주세요.", imported: 0 };
    }
    clean.push({
      shipped_on: shippedOn,
      cargo_type: cargoType,
      origin: String(draft.origin ?? "").slice(0, 500),
      destination: String(draft.destination ?? "").slice(0, 500),
      driver_name: String(draft.driver_name ?? "").slice(0, 500),
      driver_phone: String(draft.driver_phone ?? "").slice(0, 500),
      shipper_name: String(draft.shipper_name ?? "").slice(0, 500),
      memo: String(draft.memo ?? "").slice(0, 500),
    });
  }

  const ids = await createShipments(session.companyId, clean);
  revalidatePath("/shipments");
  return { message: null, imported: ids.length };
}

export interface RequestEvidenceResult {
  message: string | null;
  /** 원문 토큰. DB에는 해시만 남으므로 이 응답에서만 볼 수 있다. */
  token?: string;
  expiresAt?: string;
}

/** 증빙 요청 1건 = 토큰 1개 (05-SECURITY 위협 1). */
export async function requestEvidenceAction(
  shipmentId: string,
  kind: string,
): Promise<RequestEvidenceResult> {
  const session = await requireSession();

  if (!isEvidenceKind(kind)) return { message: "증빙 종류를 골라 주세요." };

  // 남의 운송 건이면 RLS가 걸러서 null이 온다. "없는 것"과 구분되지 않는다.
  const shipment = await getShipment(session.companyId, shipmentId).catch(() => null);
  if (!shipment) return { message: "운송 건을 찾을 수 없습니다." };

  const issued = await createEvidenceRequest(session.companyId, shipmentId, kind);
  revalidatePath(`/shipments/${shipmentId}`);
  return {
    message: null,
    token: issued.token,
    expiresAt: issued.expiresAt.toISOString(),
  };
}
