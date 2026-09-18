"use client";

import { useRef, useState, useTransition } from "react";
import SignaturePad, { type SignaturePadHandle } from "@/components/SignaturePad";
import { KINDS, SIGNER_ROLES, type EvidenceKind } from "@/lib/evidence-kind";
import { signAction } from "./actions";

interface Props {
  token: string;
  kind: EvidenceKind;
  title: string;
  companyName: string;
  shippedOn: string;
  cargoLabel: string;
  /** 대기시간 기준이 확정됐는가. 아니면 계산란에 "미지원"을 띄운다. */
  waitSupported: boolean;
}

export default function SignForm(props: Props) {
  const spec = KINDS[props.kind];
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
    set(key, (current.includes(option) ? current.filter((v) => v !== option) : [...current, option]).join(", "));
  };

  const ready = signerName.trim().length > 0 && hasInk;

  function submit() {
    setError(null);
    const png = padRef.current?.toPng();
    if (!signerName.trim()) return setError("성함을 적어주세요.");
    if (!png) return setError("서명란에 서명해 주세요.");

    startTransition(async () => {
      const outcome = await signAction({
        token: props.token,
        kind: props.kind,
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
      <div className="sign-state">
        <span className="st-mark ok" aria-hidden>
          <svg viewBox="0 0 24 24"><path d="M5 13l4.5 4.5L19 7" /></svg>
        </span>
        <h1>서명이 완료되었습니다</h1>
        <p className="st-body">{props.companyName}에 전달됐습니다. 이 창은 닫으셔도 됩니다.</p>
        <p className="st-foot">이 링크로는 더 이상 고칠 수 없습니다.</p>
      </div>
    );
  }

  return (
    <>
      {pending && (
        <div className="sending" role="status" aria-live="polite">
          <span className="sp" aria-hidden />
          <span className="s-title">보내는 중입니다</span>
          <span className="s-body">창을 닫지 마세요. 통신이 느리면 조금 걸릴 수 있습니다.</span>
        </div>
      )}

      <div className="sign-app">
        <div className="sign-scroll">
          {/* 서명 전 화면에 띄우는 정보는 최소한이다 — 요청 회사명, 종류, 날짜, 품목.
              차주 연락처·메모·출발지·화주명은 여기 없다 (05-SECURITY 위협 1). */}
          <header className="sign-head">
            <p className="sign-from">{props.companyName} 요청</p>
            <h1 className="sign-doc">{props.title}</h1>
            <p className="sign-ident">{props.shippedOn} · {props.cargoLabel}</p>
          </header>

          <p className="sign-lead">
            현장에서 확인하신 내용을 적고 서명해 주세요. 가입이나 로그인은 없습니다.
          </p>

          {error && (
            <div className="err-summary" role="alert" style={{ marginTop: 18, marginBottom: 0 }}>
              <h3>{error}</h3>
            </div>
          )}

          {spec.fields.filter((f) => f.type !== "textarea").map((field) => {
            const id = `f-${field.key}`;
            if (field.type === "checks") {
              const selected = fields[field.key]?.split(", ").filter(Boolean) ?? [];
              return (
                <div className="sign-field" key={field.key}>
                  <label>{field.label}</label>
                  <div className="od-cluster" style={{ ["--od-gap" as string]: "8px" }} role="group" aria-label={field.label}>
                    {field.options?.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`btn od-touch ${selected.includes(option) ? "btn-primary" : ""}`}
                        style={{ minHeight: 48, fontSize: 16 }}
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
              <div className="sign-field" key={field.key}>
                <label htmlFor={id}>{field.label}</label>
                <input
                  id={id}
                  type={field.type}
                  step={field.type === "time" ? 300 : undefined}
                  placeholder={field.placeholder}
                  value={fields[field.key] ?? ""}
                  onChange={(e) => set(field.key, e.target.value)}
                />
              </div>
            );
          })}

          {/* 계산이 필요한 자리를 숨기지 않고 드러낸다. 빈칸이나 0으로 두지 않는다. */}
          {props.kind === "WAIT" && !props.waitSupported && (
            <div style={{ marginTop: 20 }}>
              <div className="notice-unsupported">
                <div className="nu-title">초과 대기시간 · 청구 가능 여부 : 미지원</div>
                <div className="nu-body">
                  기산 기준이 고시 원문과 대조되지 않아 계산하지 않습니다. 시각만 기록합니다.
                </div>
              </div>
            </div>
          )}

          {spec.fields.filter((f) => f.type === "textarea").map((field) => (
            <details className="sign-extra" key={field.key}>
              <summary>{field.label} (선택)</summary>
              <div className="ex-body">
                <div className="sign-field" style={{ marginTop: 14 }}>
                  <label htmlFor={`f-${field.key}`}>{field.label}</label>
                  <input
                    id={`f-${field.key}`}
                    type="text"
                    placeholder={field.placeholder}
                    value={fields[field.key] ?? ""}
                    onChange={(e) => set(field.key, e.target.value)}
                  />
                  <span className="hint">적지 않아도 됩니다.</span>
                </div>
              </div>
            </details>
          ))}

          <div className="sign-field" style={{ marginTop: 26 }}>
            <label htmlFor="signer-name">성함</label>
            <input
              id="signer-name"
              type="text"
              autoComplete="name"
              placeholder="확인하신 분 이름"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
            />
          </div>

          <div className="sign-field">
            <label>구분</label>
            <div className="od-cluster" style={{ ["--od-gap" as string]: "8px" }} role="radiogroup" aria-label="서명자 구분">
              {SIGNER_ROLES.map((role) => (
                <button
                  key={role.value}
                  type="button"
                  className={`btn od-touch ${signerRole === role.value ? "btn-primary" : ""}`}
                  style={{ minHeight: 48, fontSize: 16 }}
                  aria-pressed={signerRole === role.value}
                  onClick={() => setSignerRole(role.value)}
                >
                  {role.label}
                </button>
              ))}
            </div>
          </div>

          <div className="sign-field">
            <label id="pad-label">서명</label>
            <SignaturePad ref={padRef} onInkChange={setHasInk} />
          </div>
        </div>

        <div className="sign-actionbar">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={submit}
            aria-disabled={!ready}
            disabled={pending}
          >
            확인하고 서명 보내기
          </button>
          <p className="why">
            {ready
              ? "보내고 나면 고칠 수 없습니다. 내용과 서명을 한 번 더 확인해 주세요."
              : "성함과 서명을 채우면 보낼 수 있습니다."}
          </p>
        </div>

        <p className="sign-foot">
          {props.companyName}이(가) 운임근거함으로 보낸 요청입니다.
        </p>
      </div>
    </>
  );
}
