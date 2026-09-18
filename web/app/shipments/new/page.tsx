import Shell from "@/components/Shell";
import { requireSession } from "@/lib/guard";
import { getCompanyName } from "@/lib/shipments";
import NewShipment from "./NewShipment";

export const metadata = { title: "새 운송 건 — 운임근거함" };

export default async function NewShipmentPage() {
  const session = await requireSession();
  const companyName = await getCompanyName(session.companyId);

  return (
    <Shell companyName={companyName} userName={session.userName} current="new">
      <div className="page-head">
        <div>
          <h1>새 운송 건</h1>
          <p className="sub">한 건씩 적거나, 엑셀에서 범위를 복사해 붙여넣습니다.</p>
        </div>
      </div>
      <NewShipment />
    </Shell>
  );
}
