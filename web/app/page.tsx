import { redirect } from "next/navigation";
import { withCompany } from "@/db/tenant";
import { currentSession } from "@/lib/session";
import { logoutAction } from "./actions";

export default async function Home() {
  const session = await currentSession();
  if (!session) redirect("/login");

  // 회사 이름 하나를 읽는 데도 withCompany를 거친다. 예외를 두기 시작하면
  // 그 예외가 늘어난다 (05-SECURITY 위협 2).
  const rows = await withCompany(session.companyId, (sql) =>
    sql<{ name: string }>("SELECT name FROM company WHERE id = $1", [session.companyId]),
  );

  return (
    <main>
      <header className="bar">
        <div>
          <strong>{rows[0]?.name ?? "회사"}</strong>
          <span className="muted"> · {session.userName}</span>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="linkish">로그아웃</button>
        </form>
      </header>

      <h1>운임근거함</h1>
      <p>운송 한 건에 붙는 증빙을 요청하고, 받고, 빠뜨린 걸 찾습니다.</p>
      <p>
        지금은 A2(인증과 테넌트 분리)까지 되어 있습니다. 화면 1은 A3에서 붙습니다 —{" "}
        <code>docs/06-FAST-TRACK.md</code>
      </p>
      <ul>
        <li>스키마와 마이그레이션 — <code>db/migrations/</code></li>
        <li>테넌트 분리 (RLS + 단일 진입점) — <code>db/tenant.ts</code></li>
        <li>로그인과 세션 — <code>lib/auth.ts</code>, <code>lib/session.ts</code></li>
        <li>규칙 인터페이스 (전부 미확정) — <code>rules/</code></li>
      </ul>
    </main>
  );
}
