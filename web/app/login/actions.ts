"use server";

import { redirect } from "next/navigation";
import { login } from "@/lib/auth";
import { requestIp } from "@/lib/request";
import { setSessionCookie } from "@/lib/session";

export interface LoginFormState {
  message: string | null;
}

export async function loginAction(
  _prev: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const outcome = await login({ email, password, ip: await requestIp() });
  if (!outcome.ok) return { message: outcome.message };

  await setSessionCookie(outcome.session);
  // redirect는 예외를 던져서 동작한다. try/catch 안에 두지 않는다.
  redirect("/");
}
