import Link from "next/link";
import { notFound } from "next/navigation";
import { CARGO_LABEL } from "@/lib/cargo";
import { requireSession } from "@/lib/guard";
import { getShipment } from "@/lib/shipments";

export const metadata = { title: "운송 건 — 운임근거함" };

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

  // 남의 회사 id를 넣으면 RLS가 걸러서 null이 온다. 404와 구분되지 않는다 —
  // 그게 의도한 동작이다. "있는데 권한이 없다"를 알려주지 않는다.
  const shipment = await getShipment(session.companyId, id).catch(() => null);
  if (!shipment) notFound();

  const rows: [string, string][] = [
    ["운송 일자", shipment.shipped_on],
    ["품목", CARGO_LABEL[shipment.cargo_type]],
    ["출발지", shipment.origin ?? "—"],
    ["도착지", shipment.destination ?? "—"],
    ["화주", shipment.shipper_name ?? "—"],
    ["차주", shipment.driver_name ?? "—"],
    ["차주 연락처", shipment.driver_phone ?? "—"],
    ["메모", shipment.memo ?? "—"],
  ];

  return (
    <main>
      <header className="bar">
        <Link href="/shipments" className="linkish">← 운송 건</Link>
      </header>

      {isNew && <p className="ok">저장했습니다.</p>}

      <h1>{shipment.shipped_on} · {CARGO_LABEL[shipment.cargo_type]}</h1>

      <section className="card">
        <dl className="rows">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card">
        <h2>증빙</h2>
        {shipment.evidence_count === 0 ? (
          <p className="muted">아직 요청한 증빙이 없습니다.</p>
        ) : (
          <p className="muted">{shipment.evidence_count}건</p>
        )}
        <button type="button" className="primary" disabled>
          증빙 요청
        </button>
        <p className="hint">
          증빙 요청은 A4(토큰 링크와 서명)에서 붙습니다 — <code>docs/06-FAST-TRACK.md</code>
        </p>
      </section>
    </main>
  );
}
