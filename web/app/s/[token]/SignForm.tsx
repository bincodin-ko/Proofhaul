"use client";

import { useRef, useState, useTransition } from "react";
import SignaturePad, { type SignaturePadHandle } from "@/components/SignaturePad";
import { KINDS, SIGNER_ROLES, type EvidenceKind } from "@/lib/evidence-kind";
import { signAction } from "./actions";

interface Props {
  token: string;
  kind: EvidenceKind;
  /** 대기시간 기준이 확정됐는가. 아니면 계산란에 "미지원"을 띄운다. */
  waitSupported: boolean;
}

export default function SignForm({ token, kind, waitSupported }: Props) {
  const spec = KINDS[kind];
  const [fields, setFields] = useState<Record<string, string>>({});
  const [signerName, setSignerName] = useState("");
  const [signerRole, setSignerRole] = useState<string>(SIGNER_ROLES[0].value);
  const [hasInk, setHasInk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const padRef = useRef<SignaturePadHandle>(null);

  const set = (key: string, value: string) => setFields((f) => ({ ...f, [key]: value }));

  const toggle = (key: string, option: string) => {
    const current = fields[key] ? fields[key]!.split(", ").filter(Boolean) : [];
    const next = current.includes(option)
      ? current.filter((v) => v !== option)
      : [...current, option];
    set(key, next.join(", "));
  };

  function submit() {
    setError(null);
    const png = padRef.current?.toPng();
    if (!signerName.trim()) return setError("서명자 성명을 적어주세요.");
    if (!png) return setError("서명란에 서명해 주세요.");

    startTransition(async () => {
      const outcome = await signAction({
        token,
        kind,
        signerName,
        signerRole,
        fields,
        signaturePng: png,
      });
      if (!outcome.ok) return setError(outcome.message);
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="notice ok-notice">
        <h2>서명이 완료되었습니다</h2>
        <p>요청하신 운송사에 전달됐습니다. 이 창은 닫으셔도 됩니다.</p>
      </div>
    );
  }

  return (
    <>
      <section className="card">
        <h2>확인 사항</h2>
        {spec.fields.map((field) => {
          const id = `f-${field.key}`;
          if (field.type === "checks") {
            const selected = fields[field.key]?.split(", ").filter(Boolean) ?? [];
            return (
              <div className="field" key={field.key}>
                <span className="label">{field.label}</span>
                <div className="chips" role="group" aria-label={field.label}>
                  {field.options?.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`chip ${selected.includes(option) ? "on" : ""}`}
                      aria-pressed={selected.includes(option)}
                      onClick={() => toggle(field.key, option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            );
          }
          return (
            <div className="field" key={field.key}>
              <label className="label" htmlFor={id}>{field.label}</label>
              {field.type === "textarea" ? (
                <textarea
                  id={id}
                  rows={2}
                  placeholder={field.placeholder}
                  value={fields[field.key] ?? ""}
                  onChange={(e) => set(field.key, e.target.value)}
                />
              ) : (
                <input
                  id={id}
                  type={field.type}
                  placeholder={field.placeholder}
                  value={fields[field.key] ?? ""}
                  onChange={(e) => set(field.key, e.target.value)}
                />
              )}
            </div>
          );
        })}

        {/* 계산이 필요한 자리를 숨기지 않고 드러낸다. 빈칸이나 0으로 두지 않는다. */}
        {kind === "WAIT" && !waitSupported && (
          <div className="unsupported">
            <div className="u-t">초과 대기시간 · 청구 가능 여부 : 미지원</div>
            <div className="u-d">
              기산 기준이 고시 원문과 대조되지 않아 계산하지 않습니다. 시각만 기록합니다.
            </div>
          </div>
        )}

        {/* 사진 첨부는 A5(파일 처리와 PDF)에서 붙는다. 업로드는 내용 기반 타입 검사와
            EXIF 제거가 함께 가야 해서 그쪽으로 미뤘다. */}
        {(kind === "ROUGH_ROAD" || kind === "WASH_SWAP") && (
          <p className="hint">사진 첨부는 곧 추가됩니다. 지금은 내용만 적어주세요.</p>
        )}
      </section>

      <section className="card">
        <h2>서명</h2>
        <div className="field">
          <label className="label" htmlFor="signer-name">성명</label>
          <input
            id="signer-name"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="서명하시는 분 이름"
          />
        </div>
        <div className="field">
          <span className="label">구분</span>
          <div className="chips" role="radiogroup" aria-label="서명자 구분">
            {SIGNER_ROLES.map((role) => (
              <button
                key={role.value}
                type="button"
                className={`chip ${signerRole === role.value ? "on" : ""}`}
                aria-pressed={signerRole === role.value}
                onClick={() => setSignerRole(role.value)}
              >
                {role.label}
              </button>
            ))}
          </div>
        </div>
        <SignaturePad ref={padRef} onInkChange={setHasInk} />
      </section>

      <div className="sign-bar">
        <button type="button" className="primary" onClick={submit} disabled={pending}>
          {pending ? "보내는 중…" : "서명하고 보내기"}
        </button>
        {error && <p className="error">{error}</p>}
        {!error && !hasInk && <p className="hint center">서명을 하면 보낼 수 있습니다</p>}
      </div>
    </>
  );
}
