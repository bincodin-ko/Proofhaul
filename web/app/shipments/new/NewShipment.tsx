"use client";

import { useState } from "react";
import SingleForm from "./SingleForm";
import PasteImport from "./PasteImport";

export default function NewShipment() {
  const [mode, setMode] = useState<"single" | "paste">("single");

  return (
    <>
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "single"}
          className={mode === "single" ? "on" : ""}
          onClick={() => setMode("single")}
        >
          한 건 입력
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "paste"}
          className={mode === "paste" ? "on" : ""}
          onClick={() => setMode("paste")}
        >
          엑셀에서 붙여넣기
        </button>
      </div>

      {mode === "single" ? <SingleForm /> : <PasteImport />}
    </>
  );
}
