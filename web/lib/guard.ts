import { redirect } from "next/navigation";
import { currentSession, type Session } from "./session";

/** 로그인한 세션. 없으면 로그인 화면으로 보낸다. */
export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) redirect("/login");
  return session;
}
