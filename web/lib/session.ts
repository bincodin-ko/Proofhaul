// 로그인 세션.
//
// 쿠키에는 임의 토큰만 담고, DB에는 해시만 저장한다. 증빙 토큰과 같은 규칙이다
// (05-SECURITY 위협 1). 쿠키를 훔쳐도 DB에서 지우면 바로 끊긴다.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { withCompany, withoutCompany } from "../db/tenant";

export const SESSION_COOKIE = "ph_session";
export const SESSION_TTL_DAYS = 14;

export interface Session {
  sessionId: string;
  userId: string;
  companyId: string;
  userName: string;
  userEmail: string;
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/** 길이가 다른 버퍼에 timingSafeEqual을 넘기면 예외가 난다. 길이부터 맞춘다. */
export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function expiryFromNow(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

/** 세션을 만들고 쿠키에 넣을 원문 토큰을 돌려준다. 원문은 여기서만 존재한다. */
export async function createSession(userId: string, companyId: string): Promise<IssuedSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = expiryFromNow();

  await withCompany(companyId, (sql) =>
    sql(
      `INSERT INTO user_session (user_id, company_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, companyId, hashToken(token), expiresAt],
    ),
  );

  return { token, expiresAt };
}

interface SessionRow {
  session_id: string;
  user_id: string;
  company_id: string;
  expires_at: Date;
  user_name: string;
  user_email: string;
}

/**
 * 토큰으로 세션을 찾는다. 없거나 만료됐으면 똑같이 null이다.
 *
 * 만료된 세션은 찾은 김에 지운다. 남겨두면 파기 배치가 돌 때까지 계속 쌓인다.
 */
export async function lookupSession(token: string): Promise<Session | null> {
  if (!token) return null;

  const rows = await withoutCompany((sql) =>
    sql<SessionRow>("SELECT * FROM session_lookup($1)", [hashToken(token)]),
  );
  const row = rows[0];
  if (!row) return null;

  if (row.expires_at.getTime() <= Date.now()) {
    await destroySessionById(row.session_id, row.company_id);
    return null;
  }

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    companyId: row.company_id,
    userName: row.user_name,
    userEmail: row.user_email,
  };
}

export async function destroySessionById(sessionId: string, companyId: string): Promise<void> {
  await withCompany(companyId, (sql) =>
    sql("DELETE FROM user_session WHERE id = $1", [sessionId]),
  );
}

export async function touchSession(session: Session): Promise<void> {
  await withCompany(session.companyId, (sql) =>
    sql("UPDATE user_session SET last_seen_at = now() WHERE id = $1", [session.sessionId]),
  );
}

// ── 쿠키 ──────────────────────────────────────────────────────────────────
//
// httpOnly: 스크립트가 못 읽는다
// secure: HTTPS에서만 나간다 (로컬 http 개발을 막지 않으려고 프로덕션에서만)
// sameSite=lax: 남의 사이트에서 온 POST에 쿠키가 실리지 않는다 (05-SECURITY 위협 7)

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

export async function setSessionCookie(issued: IssuedSession): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, issued.token, cookieOptions(issued.expiresAt));
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", cookieOptions(new Date(0)));
}

/** 현재 요청의 세션. 로그인하지 않았으면 null. */
export async function currentSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? lookupSession(token) : null;
}
