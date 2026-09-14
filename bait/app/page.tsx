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
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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

  useEffect(() => {
    markVisit();
  }, []);

  useEffect(() => {
    // 마지막 단계에 닿으면 폰트를 미리 받아둔다. 내려받기 버튼을 눌렀을 때
    // 2MB를 기다리게 하지 않으려는 것뿐이다.
    if (step === "sign") void pdfModule().then((m) => m.loadFontBytes()).catch(() => {});
  }, [step]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  const goToSign = () => {
    const bad = checkPrintable(...Object.values(common), ...Object.values(detail));
    if (bad) return setError(bad);
    setError(null);
    setStep("sign");
  };

  const goBack = () => {
    setError(null);
    if (step === "form") return setStep("pick");
    if (step === "sign") return setStep("form");
    if (step === "done") return setStep("pick");
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
    <div className="shell">
      {step !== "pick" && (
        <header className="top">
          <button type="button" className="back" onClick={goBack}>← 뒤로</button>
          <span className="crumb">{cert?.title}</span>
          <span className="step">{STEP_LABEL[step]}</span>
        </header>
      )}

      {step === "pick" && (
        <>
          <h1>안전운임 확인서 생성기</h1>
          <p className="lede">
            확인서를 폰에서 적고, 현장에서 손가락으로 서명받아 PDF로 내려받습니다.
            가입도 설치도 없습니다.
          </p>
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
          <footer className="foot">
            <p>입력한 내용은 이 브라우저 안에서만 처리됩니다. 서버로 보내지 않고 저장하지도 않습니다.</p>
            <p>{DISCLAIMER}</p>
          </footer>
        </>
      )}

      {step === "form" && cert && (
        <>
          <section className="card">
            <h2>운송 건 정보</h2>
            <div className="grid">
              {COMMON_FIELDS.map((f) => (
                <FieldInput
                  key={f.key}
                  field={f}
                  value={common[f.key] ?? ""}
                  onChange={(v) => setCommon((s) => ({ ...s, [f.key]: v }))}
                />
              ))}
            </div>
          </section>

          <section className="card">
            <h2>{cert.title}</h2>
            <div className="grid">
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
              <div className="unsupported">
                <div className="u-t">{cert.unsupported.label} : 미지원</div>
                <div className="u-d">{cert.unsupported.reason}</div>
              </div>
            )}
          </section>

          <div className="bar">
            <div className="bar-inner">
              <button type="button" className="primary" onClick={goToSign}>
                서명 받기
              </button>
              {error && <p className="error">{error}</p>}
            </div>
          </div>
        </>
      )}

      {step === "sign" && cert && (
        <>
          <section className="card">
            <h2>서명자</h2>
            <div className="grid">
              <div className="field">
                <label className="label" htmlFor="signer-name">성명</label>
                <input
                  id="signer-name"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="서명하시는 분 이름"
                />
              </div>
              <div className="field wide">
                <span className="label">구분</span>
                <div className="chips" role="radiogroup" aria-label="서명자 구분">
                  {SIGNER_ROLES.map((role) => (
                    <button
                      key={role}
                      type="button"
                      className={`chip ${signerRole === role ? "on" : ""}`}
                      aria-pressed={signerRole === role}
                      onClick={() => setSignerRole(role)}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <h2>서명</h2>
            <SignaturePad ref={padRef} onInkChange={setHasInk} />
          </section>

          <div className="bar">
            <div className="bar-inner">
              <button type="button" className="primary" onClick={download} disabled={busy}>
                {busy ? "만드는 중…" : "PDF 내려받기"}
              </button>
              {error && <p className="error">{error}</p>}
              {!error && !hasInk && <p className="note">서명을 하면 PDF를 만들 수 있습니다</p>}
            </div>
          </div>
        </>
      )}

      {step === "done" && cert && (
        <>
          <div className="done">
            <div className="check" aria-hidden>✅</div>
            <h2>PDF를 내려받았습니다</h2>
            <p>{cert.title} · 내려받기 폴더를 확인해 주세요.</p>
            <button type="button" className="linkish" onClick={startOver}>확인서 하나 더 만들기</button>
          </div>
          <footer className="foot">
            <p>{DISCLAIMER}</p>
            <p>입력값은 서버에 남지 않습니다. 이 화면을 닫으면 사라집니다.</p>
          </footer>
        </>
      )}
    </div>
  );
}
