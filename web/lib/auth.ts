// 로그인.
//
// 05-SECURITY 위협 7이 요구하는 것 네 가지를 여기 한 곳에 모은다.
//   1. 비밀번호는 argon2  → lib/password.ts
//   2. 세션 쿠키 httpOnly·secure·sameSite=lax → lib/session.ts
//   3. 로그인 시도 속도 제한
//   4. 계정 존재 여부가 응답에서 드러나지 않게 통일

import { createHash } from "node:crypto";
import { withoutCompany } from "../db/tenant";
import { burnVerifyTime, verifyPassword } from "./password";
import { createSession, type IssuedSession } from "./session";

/**
 * 실패하는 모든 경우에 똑같이 나가는 문구.
 *
 * 없는 계정과 틀린 비밀번호를 구분해서 알려주면 이메일 목록을 만들 수 있다.
 * 비밀번호 재설정을 붙일 때도 같은 문구를 쓴다.
 */
export const LOGIN_FAILED_MESSAGE = "이메일 또는 비밀번호가 올바르지 않습니다.";

export const THROTTLED_MESSAGE =
  "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.";

/** 속도 제한. 창 안의 실패 횟수가 기준을 넘으면 검증 자체를 하지 않는다. */
const THROTTLE = {
  window: "15 minutes",
  maxByIp: 20,
  maxByEmail: 10,
} as const;

export type LoginOutcome =
  | { ok: true; session: IssuedSession; userId: string; companyId: string }
  | { ok: false; message: string };

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * 시도 기록에 남길 이메일 지문.
 *
 * 실패 로그가 그대로 이메일 목록이 되면 안 된다. 되돌릴 수 없게 만드는 게 아니라
 * 훑어서 목록을 만들기 어렵게 하는 정도다.
 */
function emailFingerprint(email: string): Buffer {
  return createHash("sha256").update(`login:${email}`, "utf8").digest();
}

interface UserRow {
  id: string;
  company_id: string;
  password_hash: string;
  name: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  /** 요청 IP. 알 수 없으면 null — 그러면 이메일 기준 제한만 걸린다. */
  ip: string | null;
}

export async function login({ email, password, ip }: LoginRequest): Promise<LoginOutcome> {
  const normalized = normalizeEmail(email);
  const fingerprint = emailFingerprint(normalized);

  const { byIp, byEmail } = await recentFailures(ip, fingerprint);
  if (byIp >= THROTTLE.maxByIp || byEmail >= THROTTLE.maxByEmail) {
    // 비밀번호 검증도 하지 않는다. 제한이 걸린 상태에서 계정 존재 여부가 새지 않게.
    return { ok: false, message: THROTTLED_MESSAGE };
  }

  const rows = await withoutCompany((sql) =>
    sql<UserRow>("SELECT * FROM auth_lookup_user($1)", [normalized]),
  );
  const user = rows[0];

  // 계정이 없어도 같은 시간을 쓴다. 응답 시간이 존재 여부를 알려주지 않게.
  const passwordOk = user
    ? await verifyPassword(user.password_hash, password)
    : (await burnVerifyTime(password), false);

  await noteAttempt(ip, fingerprint, passwordOk);

  if (!user || !passwordOk) {
    return { ok: false, message: LOGIN_FAILED_MESSAGE };
  }

  const session = await createSession(user.id, user.company_id);
  return { ok: true, session, userId: user.id, companyId: user.company_id };
}

async function recentFailures(
  ip: string | null,
  fingerprint: Buffer,
): Promise<{ byIp: number; byEmail: number }> {
  const rows = await withoutCompany((sql) =>
    sql<{ by_ip: string; by_email: string }>(
      "SELECT * FROM auth_recent_failures($1, $2, $3::interval)",
      [ip, fingerprint, THROTTLE.window],
    ),
  );
  const row = rows[0];
  return { byIp: Number(row?.by_ip ?? 0), byEmail: Number(row?.by_email ?? 0) };
}

async function noteAttempt(ip: string | null, fingerprint: Buffer, succeeded: boolean) {
  await withoutCompany((sql) =>
    sql("SELECT auth_note_attempt($1, $2, $3)", [ip, fingerprint, succeeded]),
  );
}
