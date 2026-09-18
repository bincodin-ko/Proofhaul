"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import FieldInput from "@/components/FieldInput";
import SignaturePad, { SignaturePadHandle } from "@/components/SignaturePad";
import { CERT_TYPES, CertId, COMMON_FIELDS, DISCLAIMER, SIGNER_ROLES, getCert } from "@/lib/certs";
import { unprintable } from "@/lib/font-coverage";
import { countGenerated, markVisit } from "@/lib/metrics";

// pdf-lib는 500KB가 넘는다. 첫 화면에 끼워 넣으면 도구를 열어보기도 전에
// 기다리게 된다. 서명 단계에 닿을 때 미리 받고, 쓸 때 불러온다.
const pdfModule = () => import("@/lib/pdf");

type Step = "pick" | "form" | "sign" | "done";
type Values = Record<string, string>;

const STEP_LABEL: Record<Step, string> = { pick: "1/3", form: "2/3", sign: "3/3", done: "완료" };

/**
 * 폰트에 없는 글자는 PDF에 빈칸으로 찍힌다. 서명까지 받은 뒤에 알게 되면 늦으므로
 * 다음 단계로 넘어가기 전에 막는다.
 */
function checkPrintable(...texts: string[]): string | null {
  const bad = unprintable(texts.filter(Boolean).join("\n"));
  if (bad.length === 0) return null;
  return `PDF에 넣을 수 없는 글자가 있습니다: ${bad.join(" ")} — 이대로 만들면 빈칸으로 인쇄됩니다. 지우거나 한글·숫자로 바꿔주세요.`;
}

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function Page() {
  const [step, setStep] = useState<Step>("pick");
  const [certId, setCertId] = useState<CertId | null>(null);
  const [common, setCommon] = useState<Values>({ shippedOn: today() });
  const [detail, setDetail] = useState<Values>({});
  const [signerName, setSignerName] = useState("");
  const [signerRole, setSignerRole] = useState<string>(SIGNER_ROLES[0]);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const padRef = useRef<SignaturePadHandle>(null);

  const cert = useMemo(() => (certId ? getCert(certId) : null), [certId]);

  useEffect(() => { markVisit(); }, []);

  useEffect(() => {
    // 마지막 단계에 닿으면 폰트를 미리 받아둔다.
    if (step === "sign") void pdfModule().then((m) => m.loadFontBytes()).catch(() => {});
  }, [step]);

  useEffect(() => { window.scrollTo(0, 0); }, [step]);

  const goBack = () => {
    setError(null);
    if (step === "form") return setStep("pick");
    if (step === "sign") return setStep("form");
    if (step === "done") return setStep("pick");
  };

  const goToSign = () => {
    const bad = checkPrintable(...Object.values(common), ...Object.values(detail));
    if (bad) return setError(bad);
    setError(null);
    setStep("sign");
  };

  const startOver = () => {
    setStep("pick");
    setCertId(null);
    setDetail({});
    setSignerName("");
    setHasInk(false);
    setError(null);
    padRef.current?.clear();
  };

  async function download() {
    if (!cert) return;
    const png = padRef.current?.toPng();
    if (!signerName.trim()) return setError("서명자 성명을 적어주세요.");
    if (!png) return setError("서명란에 서명해 주세요.");
    const bad = checkPrintable(...Object.values(common), ...Object.values(detail), signerName);
    if (bad) return setError(bad);

    setBusy(true);
    setError(null);
    try {
      const { buildCertPdf, fileNameFor } = await pdfModule();
      const createdAt = new Date();
      const doc = { cert, common, detail, signerName: signerName.trim(), signerRole, signaturePng: png, createdAt };
      const blob = await buildCertPdf(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileNameFor(doc);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      countGenerated(cert.id);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF를 만들지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sign-app">
      <div className="sign-scroll">
        {step !== "pick" && (
          <div className="bait-bar">
            <button type="button" className="back" onClick={goBack}>← 뒤로</button>
            <span className="crumb">{cert?.title}</span>
            <span className="step">{STEP_LABEL[step]}</span>
          </div>
        )}

        {step === "pick" && (
          <>
            <div className="bait-head">
              <h1>안전운임 확인서 생성기</h1>
              <p>
                확인서를 폰에서 적고, 현장에서 손가락으로 서명받아 PDF로 내려받습니다.
                가입도 설치도 없습니다.
              </p>
            </div>
            <div className="pick">
              {CERT_TYPES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { setCertId(c.id); setDetail({}); setStep("form"); }}
                >
                  <span className="emoji" aria-hidden>{c.emoji}</span>
                  <span className="body">
                    <span className="t">{c.title}</span>
                    <span className="d">{c.desc}</span>
                  </span>
                  <span className="arrow" aria-hidden>›</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === "form" && cert && (
          <>
            <div className="sign-section">
              <h2>운송 건 정보</h2>
              <div className="bait-grid">
                {COMMON_FIELDS.map((f) => (
                  <FieldInput
                    key={f.key}
                    field={f}
                    value={common[f.key] ?? ""}
                    onChange={(v) => setCommon((s) => ({ ...s, [f.key]: v }))}
                  />
                ))}
              </div>
            </div>

            <div className="sign-section">
              <h2>{cert.title}</h2>
              <div className="bait-grid">
                {cert.fields.map((f) => (
                  <FieldInput
                    key={f.key}
                    field={f}
                    value={detail[f.key] ?? ""}
                    onChange={(v) => setDetail((s) => ({ ...s, [f.key]: v }))}
                  />
                ))}
              </div>
              {cert.unsupported && (
                <div style={{ marginTop: 18 }}>
                  <div className="notice-unsupported">
                    <div className="nu-title">{cert.unsupported.label} : 미지원</div>
                    <div className="nu-body">{cert.unsupported.reason}</div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {step === "sign" && cert && (
          <>
            <div className="sign-section">
              <h2>서명자</h2>
              <div className="sign-field">
                <label htmlFor="signer-name">성명</label>
                <input
                  id="signer-name"
                  type="text"
                  autoComplete="name"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="서명하시는 분 이름"
                />
              </div>
              <div className="sign-field">
                <label>구분</label>
                <div className="od-cluster" style={{ ["--od-gap" as string]: "8px" }} role="radiogroup" aria-label="서명자 구분">
                  {SIGNER_ROLES.map((role) => (
                    <button
                      key={role}
                      type="button"
                      className={`btn od-touch ${signerRole === role ? "btn-primary" : ""}`}
                      style={{ minHeight: 46, fontSize: 16 }}
                      aria-pressed={signerRole === role}
                      onClick={() => setSignerRole(role)}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="sign-section">
              <h2>서명</h2>
              <SignaturePad ref={padRef} onInkChange={setHasInk} />
            </div>
          </>
        )}

        {step === "done" && cert && (
          <div className="sign-state" style={{ minHeight: "auto", padding: "40px 0" }}>
            <span className="st-mark ok" aria-hidden>
              <svg viewBox="0 0 24 24"><path d="M5 13l4.5 4.5L19 7" /></svg>
            </span>
            <h1>PDF를 내려받았습니다</h1>
            <p className="st-body">{cert.title} · 내려받기 폴더를 확인해 주세요.</p>
            <div className="st-actions">
              <button type="button" className="btn btn-primary btn-lg" onClick={startOver}>
                확인서 하나 더 만들기
              </button>
            </div>
          </div>
        )}

        {step === "pick" && (
          <p className="sign-foot" style={{ padding: "28px 0 0" }}>
            입력한 내용은 이 브라우저 안에서만 처리됩니다. 서버로 보내지 않고 저장하지도 않습니다.
            <br />{DISCLAIMER}
          </p>
        )}
      </div>

      {(step === "form" || step === "sign") && (
        <div className="sign-actionbar">
          {step === "form" ? (
            <button type="button" className="btn btn-primary btn-lg" onClick={goToSign}>
              서명 받기
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-lg" onClick={download} disabled={busy}>
              {busy ? "만드는 중…" : "PDF 내려받기"}
            </button>
          )}
          {error ? (
            <p className="why" style={{ color: "var(--miss)", fontWeight: 600 }}>{error}</p>
          ) : (
            step === "sign" && !hasInk && <p className="why">서명을 하면 PDF를 만들 수 있습니다.</p>
          )}
        </div>
      )}

      {step === "done" && (
        <p className="sign-foot">
          {DISCLAIMER}
          <br />입력값은 서버에 남지 않습니다. 이 화면을 닫으면 사라집니다.
        </p>
      )}
    </div>
  );
}
