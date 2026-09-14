"use server";

import { headers } from "next/headers";
import { cleanPayload, isEvidenceKind, isSignerRole } from "@/lib/evidence-kind";
import { requestIp } from "@/lib/request";
import { saveSignaturePng, StorageError } from "@/lib/storage";
import { lookupByToken, signWithToken } from "@/lib/token";

export interface SignPayload {
  token: string;
  kind: string;
  signerName: string;
  signerRole: string;
  fields: Record<string, string>;
  signaturePng: string;
}

export type SignOutcome = { ok: true } | { ok: false; message: string };

const GONE_MESSAGE = "이 링크는 만료되었거나 올바르지 않습니다.";

/**
 * 서명 저장.
 *
 * 화면이 보낸 값을 믿지 않는다. 토큰으로 증빙을 다시 찾아서 종류와 회사를 확인하고,
 * 그 종류에 정의된 항목만 남긴다. kind를 폼에서 받아 쓰면 다른 종류의 항목을
 * 밀어 넣을 수 있다.
 */
export async function signAction(input: SignPayload): Promise<SignOutcome> {
  const ip = await requestIp();

  const signerName = String(input.signerName ?? "").trim().slice(0, 100);
  if (!signerName) return { ok: false, message: "서명자 성명을 적어주세요." };

  const signerRole = String(input.signerRole ?? "");
  if (!isSignerRole(signerRole)) return { ok: false, message: "서명자 구분을 골라주세요." };

  const found = await lookupByToken(String(input.token ?? ""), ip);
  if (found.state === "throttled") {
    return { ok: false, message: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." };
  }
  if (found.state !== "ok") return { ok: false, message: GONE_MESSAGE };

  const kind = found.view.kind;
  if (!isEvidenceKind(kind)) return { ok: false, message: GONE_MESSAGE };

  const payload = cleanPayload(kind, input.fields ?? {});

  let signaturePath: string;
  try {
    signaturePath = await saveSignaturePng(String(input.signaturePng ?? ""), found.view.companyId);
  } catch (error) {
    if (error instanceof StorageError) return { ok: false, message: error.message };
    throw error;
  }

  const userAgent = (await headers()).get("user-agent");

  const signed = await signWithToken({
    token: input.token,
    signerName,
    signerRole,
    payload,
    signaturePath,
    ip,
    userAgent,
  });

  // 0행이 갱신됐다면 그 사이에 만료됐거나 이미 서명된 것이다.
  if (!signed) return { ok: false, message: GONE_MESSAGE };
  return { ok: true };
}
