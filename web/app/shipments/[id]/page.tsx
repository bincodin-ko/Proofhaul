import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/Shell";
import { CARGO_LABEL } from "@/lib/cargo";
import { displayStatus, listEvidence, STATUS_LABEL } from "@/lib/evidence";
import { KINDS } from "@/lib/evidence-kind";
import { requireSession } from "@/lib/guard";
import { getCompanyName, getShipment } from "@/lib/shipments";
import RequestEvidence from "./RequestEvidence";

export const metadata = { title: "운송 건 — 운임근거함" };

const BADGE: Record<string, string> = {
  REQUESTED: "badge-req",
  SIGNED: "badge-signed",
  EXPIRED: "badge-plain",
};

export default async function ShipmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const { new: isNew } = await searchParams;

  // 남의 회사 id를 넣으면 RLS가 걸러서 null이 온다. 404와 구분되지 않는다.
  const shipment = await getShipment(session.companyId, id).catch(() => null);
  if (!shipment) notFound();

  const [companyName, evidence] = await Promise.all([
    getCompanyName(session.companyId),
    listEvidence(session.companyId, id),
  ]);

  const rows: [string, string | null][] = [
    ["운송 일자", shipment.shipped_on],
    ["품목", CARGO_LABEL[shipment.cargo_type]],
    ["출발지", shipment.origin],
    ["도착지", shipment.destination],
    ["화주", shipment.shipper_name],
    ["차주", shipment.driver_name],
    ["차주 연락처", shipment.driver_phone],
    ["메모", shipment.memo],
  ];

  return (
    <Shell companyName={companyName} userName={session.userName} current="shipments">
      {isNew && <div className="flash" role="status">저장했습니다. 이제 증빙을 요청할 수 있습니다.</div>}

      <div className="page-head">
        <div>
          <h1>{shipment.shipped_on} · {CARGO_LABEL[shipment.cargo_type]}</h1>
          <p className="sub">
            <Link href="/shipments">← 운송 건 목록</Link>
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>운송 건 정보</h2></div>
        <div className="card-body">
          <table className="kv">
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{value ?? <span className="dash">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>증빙</h2>
          {evidence.length > 0 && <span className="badge badge-plain">{evidence.length}건</span>}
        </div>

        {evidence.length > 0 && (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>종류</th>
                  <th>상태</th>
                  <th>서명자</th>
                  <th>만료</th>
                </tr>
              </thead>
              <tbody>
                {evidence.map((row) => {
                  const status = displayStatus(row);
                  return (
                    <tr key={row.id}>
                      <td>{KINDS[row.kind]?.short ?? row.kind}</td>
                      <td><span className={`badge ${BADGE[status]}`}>{STATUS_LABEL[status]}</span></td>
                      <td>{row.signer_name ?? <span className="dash">—</span>}</td>
                      <td>{row.expires_at.toLocaleDateString("ko-KR")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="card-body">
          {evidence.length === 0 && (
            <p style={{ color: "var(--ink-2)", marginBottom: 18 }}>아직 요청한 증빙이 없습니다.</p>
          )}
          <RequestEvidence shipmentId={id} />
        </div>
      </div>
    </Shell>
  );
}
