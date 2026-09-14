import Link from "next/link";
import { requireSession } from "@/lib/guard";
import NewShipment from "./NewShipment";

export const metadata = { title: "새 운송 건 — 운임근거함" };

export default async function NewShipmentPage() {
  await requireSession();
  return (
    <main>
      <header className="bar">
        <Link href="/shipments" className="linkish">← 운송 건</Link>
      </header>
      <h1>새 운송 건</h1>
      <NewShipment />
    </main>
  );
}
