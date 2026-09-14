// A1 단계의 자리 표시. 화면 1·2·3은 A3·A4·A6에서 만든다.

export default function Home() {
  return (
    <main>
      <h1>운임근거함</h1>
      <p>운송 한 건에 붙는 증빙을 요청하고, 받고, 빠뜨린 걸 찾습니다.</p>
      <p>
        지금은 A1(골격과 규칙 인터페이스)까지 되어 있습니다. 화면은 A3부터 붙습니다 —{" "}
        <code>docs/06-FAST-TRACK.md</code>
      </p>
      <ul>
        <li>스키마와 마이그레이션 — <code>db/migrations/</code></li>
        <li>테넌트 분리 (RLS + 단일 진입점) — <code>db/tenant.ts</code></li>
        <li>규칙 인터페이스 (전부 미확정) — <code>rules/</code></li>
      </ul>
    </main>
  );
}
