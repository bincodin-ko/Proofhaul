"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { KINDS, REQUESTABLE, type EvidenceKind } from "@/lib/evidence-kind";
import { requestEvidenceAction } from "../actions";

export default function RequestEvidence({ shipmentId }: { shipmentId: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<EvidenceKind>("WAIT");
  const [link, setLink] = useState<string | null>(null);
  const [expires, setExpires] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await requestEvidenceAction(shipmentId, kind);
      if (result.message || !result.token) {
        return setError(result.message ?? "링크를 만들지 못했습니다.");
      }
      setLink(`${window.location.origin}/s/${result.token}`);
      setExpires(result.expiresAt ? new Date(result.expiresAt).toLocaleDateString("ko-KR") : null);
      router.refresh();
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError("복사하지 못했습니다. 주소를 직접 선택해 복사해 주세요.");
    }
  }

  return (
    <div>
      <div className="field" style={{ marginBottom: 14 }}>
        <label>증빙 종류</label>
        <div className="od-cluster" style={{ ["--od-gap" as string]: "8px" }} role="radiogroup" aria-label="증빙 종류">
          {REQUESTABLE.map((id) => (
            <button
              key={id}
              type="button"
              className={`btn ${kind === id ? "btn-primary" : ""}`}
              aria-pressed={kind === id}
              onClick={() => { setKind(id); setLink(null); }}
            >
              {KINDS[id].short}
            </button>
          ))}
        </div>
      </div>

      <button className="btn btn-primary" type="button" style={{ minHeight: 42 }} onClick={create} disabled={pending}>
        {pending ? "만드는 중…" : "서명 링크 만들기"}
      </button>

      {error && (
        <div className="err-summary" role="alert" style={{ marginTop: 16, marginBottom: 0 }}>
          <h3>{error}</h3>
        </div>
      )}

      {link && (
        <div className="link-box" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            이 주소를 화주 담당자나 차주에게 보내세요
            {expires && ` · ${expires}까지`}
          </div>
          <code className="link-url">{link}</code>
          <div className="od-row" style={{ ["--od-gap" as string]: "8px" }}>
            <button className="btn" type="button" onClick={copy}>{copied ? "복사됨" : "링크 복사"}</button>
          </div>
          <p className="link-once">
            로그인 없이 열립니다. <strong>이 주소는 지금만 볼 수 있습니다</strong> — 서버에는 해시만 남아
            다시 만들 수 없습니다.
          </p>
        </div>
      )}
    </div>
  );
}
