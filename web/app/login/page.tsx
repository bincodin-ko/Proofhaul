import { redirect } from "next/navigation";
import { currentSession } from "@/lib/session";
import LoginForm from "./LoginForm";

export const metadata = { title: "로그인 — 운임근거함" };

export default async function LoginPage() {
  if (await currentSession()) redirect("/");
  return (
    <main className="narrow">
      <h1>운임근거함</h1>
      <p>운송사 계정으로 로그인합니다.</p>
      <LoginForm />
    </main>
  );
}
