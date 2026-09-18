import { redirect } from "next/navigation";
import { currentSession } from "@/lib/session";
import LoginForm from "./LoginForm";

export const metadata = { title: "로그인 — 운임근거함" };

export default async function LoginPage() {
  if (await currentSession()) redirect("/shipments");

  return (
    <div className="auth-wrap">
      <div className="auth-box">
        <div className="auth-head">
          <div className="an">운임근거함</div>
          <p>운송 한 건에 붙는 증빙을 요청하고, 받고, 빠뜨린 걸 찾습니다.</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
