import Link from "next/link";
import Shell from "@/components/Shell";
import { CARGO_LABEL } from "@/lib/cargo";
import { requireSession } from "@/lib/guard";
import { getCompanyName, listShipments } from "@/lib/shipments";

export const metadata = { title: "운송 건 — 운임근거함" };

export default async function ShipmentsPage() {
  const session = await requireSession();
  const [companyName, shipments] = await Promise.all([
    getCompanyName(session.companyId),
    listShipments(session.companyId),
  ]);

  return (
    <Shell companyName={companyName} userName={session.userName} current="shipments">
      <div className="page-head">
        <div>
          <h1>운송 건</h1>
          <p className="sub">등록된 {shipments.length}건</p>
        </div>
        <Link className="btn btn-primary" href="/shipments/new">새 운송 건</Link>
      </div>

      <div className="card">
        {shipments.length === 0 ? (
          <div className="card-body">
            <p style={{ color: "var(--ink-2)" }}>
              아직 등록된 운송 건이 없습니다.{" "}
              <Link href="/shipments/new">엑셀에서 붙여넣어</Link> 한 번에 올릴 수 있습니다.
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table">
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
                    <td>
                      <Link className="rowlink" href={`/shipments/${s.id}`}>{s.shipped_on}</Link>
                    </td>
                    <td>{CARGO_LABEL[s.cargo_type]}</td>
                    <td>
                      {s.origin || s.destination ? (
                        <>
                          {s.origin ?? "—"}
                          <span className="t-sub">→ {s.destination ?? "—"}</span>
                        </>
                      ) : (
                        <span className="dash">—</span>
                      )}
                    </td>
                    <td>{s.shipper_name ?? <span className="dash">—</span>}</td>
                    <td>{s.driver_name ?? <span className="dash">—</span>}</td>
                    <td className="num">
                      {s.evidence_count === 0 ? (
                        <span className="badge badge-miss">없음</span>
                      ) : (
                        s.evidence_count
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
