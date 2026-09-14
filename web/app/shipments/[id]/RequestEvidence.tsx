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
      // 주소는 브라우저가 보고 있는 곳을 그대로 쓴다. 설정값을 하나 줄인다.
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
    <div className="request">
      <div className="field">
        <span className="label">증빙 종류</span>
        <div className="chips" role="radiogroup" aria-label="증빙 종류">
          {REQUESTABLE.map((id) => (
            <button
              key={id}
              type="button"
              className={`chip ${kind === id ? "on" : ""}`}
              aria-pressed={kind === id}
              onClick={() => { setKind(id); setLink(null); }}
            >
              {KINDS[id].short}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="primary" onClick={create} disabled={pending}>
        {pending ? "만드는 중…" : "서명 링크 만들기"}
      </button>

      {error && <p className="error">{error}</p>}

      {link && (
        <div className="link-box">
          <p className="hint">
            이 주소를 화주 담당자나 차주에게 보내세요. 로그인 없이 열립니다.
            {expires && ` ${expires}까지 유효합니다.`}
          </p>
          <div className="link-row">
            <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="서명 링크" />
            <button type="button" onClick={copy}>{copied ? "복사됨" : "복사"}</button>
          </div>
          <p className="hint">
            이 주소는 지금만 볼 수 있습니다. 서버에는 해시만 남아 다시 만들 수 없습니다.
          </p>
        </div>
      )}
    </div>
  );
}
