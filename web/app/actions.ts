"use server";

import { redirect } from "next/navigation";
import { clearSessionCookie, currentSession, destroySessionById } from "@/lib/session";

export async function logoutAction(): Promise<void> {
  const session = await currentSession();
  // 쿠키만 지우지 않고 DB의 세션도 지운다. 쿠키가 어딘가 남아 있어도 못 쓰게.
  if (session) await destroySessionById(session.sessionId, session.companyId);
  await clearSessionCookie();
  redirect("/login");
}
