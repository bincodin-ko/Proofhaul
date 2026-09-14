"use client";

import { useActionState } from "react";
import { CARGO_LABEL, CARGO_TYPES } from "@/lib/cargo";
import { createShipmentAction, type FormState } from "../actions";

const INITIAL: FormState = { message: null };

function today() {
  const now = new Date();
  const kst = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return kst.format(now);
}

export default function SingleForm() {
  const [state, action, pending] = useActionState(createShipmentAction, INITIAL);

  return (
    <form action={action} className="card">
      <div className="grid">
        <div className="field">
          <label htmlFor="shipped_on">운송 일자</label>
          <input id="shipped_on" name="shipped_on" type="date" defaultValue={today()} required />
        </div>
        <div className="field">
          <label htmlFor="cargo_type">품목</label>
          <select id="cargo_type" name="cargo_type" defaultValue="CONTAINER_40">
            {CARGO_TYPES.map((type) => (
              <option key={type} value={type}>{CARGO_LABEL[type]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="origin">출발지</label>
          <input id="origin" name="origin" />
        </div>
        <div className="field">
          <label htmlFor="destination">도착지</label>
          <input id="destination" name="destination" />
        </div>
        <div className="field">
          <label htmlFor="driver_name">차주 성명</label>
          <input id="driver_name" name="driver_name" />
        </div>
        <div className="field">
          <label htmlFor="driver_phone">차주 연락처</label>
          <input id="driver_phone" name="driver_phone" inputMode="tel" />
        </div>
        <div className="field wide">
          <label htmlFor="shipper_name">화주</label>
          <input id="shipper_name" name="shipper_name" />
        </div>
        <div className="field wide">
          <label htmlFor="memo">메모</label>
          <textarea id="memo" name="memo" rows={2} />
        </div>
      </div>

      <button type="submit" className="primary" disabled={pending}>
        {pending ? "저장 중…" : "저장하고 증빙 요청으로"}
      </button>
      {state.message && <p className="error">{state.message}</p>}
    </form>
  );
}
