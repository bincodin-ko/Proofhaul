import Link from "next/link";
import { CARGO_LABEL } from "@/lib/cargo";
import { requireSession } from "@/lib/guard";
import { listShipments } from "@/lib/shipments";
import { logoutAction } from "../actions";

export const metadata = { title: "운송 건 — 운임근거함" };

export default async function ShipmentsPage() {
  const session = await requireSession();
  const shipments = await listShipments(session.companyId);

  return (
    <main>
      <header className="bar">
        <div>
          <strong>운임근거함</strong>
          <span className="muted"> · {session.userName}</span>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="linkish">로그아웃</button>
        </form>
      </header>

      <div className="head">
        <h1>운송 건</h1>
        <Link className="button" href="/shipments/new">새 운송 건</Link>
      </div>

      {shipments.length === 0 ? (
        <p className="empty">
          아직 등록된 운송 건이 없습니다. <Link href="/shipments/new">엑셀에서 붙여넣어</Link> 한 번에
          올릴 수 있습니다.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>운송 일자</th>
                <th>품목</th>
                <th>구간</th>
                <th>화주</th>
                <th>차주</th>
                <th className="num">증빙</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/shipments/${s.id}`}>{s.shipped_on}</Link></td>
                  <td>{CARGO_LABEL[s.cargo_type]}</td>
                  <td className="muted">
                    {[s.origin, s.destination].filter(Boolean).join(" → ") || "—"}
                  </td>
                  <td>{s.shipper_name ?? "—"}</td>
                  <td>{s.driver_name ?? "—"}</td>
                  <td className="num">
                    {s.evidence_count === 0 ? <span className="missing">없음</span> : s.evidence_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
