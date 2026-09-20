"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FieldInput from "@/components/FieldInput";
import SignaturePad, { SignaturePadHandle } from "@/components/SignaturePad";
import SurveyCard from "@/components/SurveyCard";
import {
  CERT_TYPES,
  CONFIRMER_FIELDS,
  CertId,
  CertType,
  DISCLAIMER,
  OfficialForm,
  certForForm,
  formFields,
  getCert,
  resolveForm,
  splitPicked,
} from "@/lib/certs";
import { formatFormDateTime } from "@/lib/format";
import { unprintable } from "@/lib/font-coverage";
import { decodeRequest, requestUrl } from "@/lib/link";
import { countGenerated, markVisit } from "@/lib/metrics";
import { shouldAsk, type SurveySet } from "@/lib/survey";
import {
  DocRecord,
  DocStatus,
  clearAll,
  loadDocs,
  loadMe,
  newId,
  rememberMe,
  removeDoc,
  saveDoc,
  updateDocStatus,
} from "@/lib/store";

// pdf-lib는 500KB가 넘는다. 첫 화면에 끼워 넣으면 도구를 열어보기도 전에
// 기다리게 된다. 서명 단계에 닿을 때 미리 받고, 쓸 때 불러온다.
const pdfModule = () => import("@/lib/pdf");

type Mode = "home" | "form" | "sign" | "done" | "link" | "guest" | "guest-done";
type Values = Record<string, string>;

const STATUS_LABEL: Record<DocStatus, string> = {
  SIGNED: "서명 완료",
  REQUESTED: "서명 기다리는 중",
  RECEIVED: "받음",
};

/**
 * 폰트에 없는 글자는 PDF에 빈칸으로 찍힌다. 서명까지 받은 뒤에 알게 되면 늦으므로
 * 다음 단계로 넘어가기 전에 막는다.
 */
function checkPrintable(...texts: string[]): string | null {
  const bad = unprintable(texts.filter(Boolean).join("\n"));
  if (bad.length === 0) return null;
  return `PDF에 넣을 수 없는 글자가 있습니다: ${bad.join(" ")} — 이대로 만들면 빈칸으로 인쇄됩니다. 지우거나 한글·숫자로 바꿔주세요.`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 목록 한 줄의 둘째 줄. 제목에 이미 사업장이 있으니 여기엔 넣지 않는다. */
function docSubtitle(record: DocRecord): string {
  return [record.values.containerNo, record.values.vehicleNo].filter(Boolean).join(" · ");
}

/** 폰의 공유 기능으로 파일을 넘긴다. 안 되면 false를 주고 내려받기로 떨어진다. */
async function sharePdfFile(blob: Blob, fileName: string): Promise<boolean> {
  try {
    const file = new File([blob], fileName, { type: "application/pdf" });
    if (!navigator.canShare?.({ files: [file] })) return false;
    await navigator.share({ files: [file], title: fileName });
    return true;
  } catch {
    return false; // 사용자가 취소했거나 지원하지 않는다
  }
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function Page() {
  const [mode, setMode] = useState<Mode>("home");
  const [certId, setCertId] = useState<CertId | null>(null);
  const [variant, setVariant] = useState<string>("");
  const [values, setValues] = useState<Values>({});
  const [confirmer, setConfirmer] = useState<Values>({});
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [docId, setDocId] = useState<string>("");
  const [shareUrl, setShareUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [guest, setGuest] = useState<{ form: OfficialForm; cert: CertType; from: string } | null>(null);
  const [guestPdf, setGuestPdf] = useState<{ blob: Blob; name: string } | null>(null);
  const [hasInk, setHasInk] = useState(false);
  // 설문을 물을지는 localStorage를 읽어야 안다. 서버 렌더와 어긋나지 않게 화면에 붙은 뒤에 정한다.
  const [ask, setAsk] = useState<SurveySet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const padRef = useRef<SignaturePadHandle>(null);

  const cert = useMemo(() => (certId ? getCert(certId) : null), [certId]);
  const form = useMemo(() => (cert ? resolveForm(cert, variant) : null), [cert, variant]);

  // 링크로 들어왔는지 먼저 본다. 링크면 화주 화면이고, 아니면 평소 화면이다.
  useEffect(() => {
    markVisit();
    const request = decodeRequest(window.location.hash);
    if (request) {
      setGuest({ form: request.form, cert: certForForm(request.form.id), from: request.from });
      setValues(request.values);
      setMode("guest");
      return;
    }
    setDocs(loadDocs());
  }, []);

  useEffect(() => {
    // 서명 단계에 닿으면 폰트를 미리 받아둔다.
    if (mode === "sign" || mode === "guest") void pdfModule().then((m) => m.loadFontBytes()).catch(() => {});
  }, [mode]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [mode]);

  const refreshDocs = useCallback(() => setDocs(loadDocs()), []);

  const goHome = useCallback(() => {
    setMode("home");
    setCertId(null);
    setVariant("");
    setValues({});
    setConfirmer({});
    setDocId("");
    setShareUrl("");
    setCopied(false);
    setHasInk(false);
    setAsk(null);
    setError(null);
    padRef.current?.clear();
    refreshDocs();
  }, [refreshDocs]);

  const goBack = () => {
    setError(null);
    if (mode === "form") return goHome();
    if (mode === "sign") return setMode("form");
    if (mode === "link") return setMode("form");
    goHome();
  };

  const startCert = (picked: CertType) => {
    const me = loadMe();
    setCertId(picked.id);
    setVariant(picked.pick.variants[0]?.label ?? "");
    setValues({ ...me });
    setDocId(newId());
    setError(null);
    setMode("form");
  };

  const changeVariant = (label: string) => {
    // 서식이 바뀌면 항목이 달라진다. 기억해둔 내 정보만 남기고 나머지는 비운다.
    setVariant(label);
    setValues({ ...loadMe() });
  };

  const goToSign = () => {
    const bad = checkPrintable(...Object.values(values));
    if (bad) return setError(bad);
    setError(null);
    setMode("sign");
  };

  /** 링크를 만든다. 아직 서명은 없다 — 목록에는 "기다리는 중"으로 남는다. */
  const makeLink = () => {
    if (!cert || !form) return;
    const bad = checkPrintable(...Object.values(values));
    if (bad) return setError(bad);
    try {
      const from = (values.carrierName || values.driverName || "").trim();
      const url = requestUrl({ form, values, from });
      rememberMe(values);
      saveDoc({
        id: docId || newId(),
        certId: cert.id,
        formId: form.id,
        variant,
        values,
        status: "REQUESTED",
        createdAt: new Date().toISOString(),
      });
      countGenerated(cert.id, "request");
      setShareUrl(url);
      setCopied(false);
      setError(null);
      setMode("link");
    } catch (e) {
      setError(e instanceof Error ? e.message : "링크를 만들지 못했습니다.");
    }
  };

  const shareLink = async () => {
    if (!form) return;
    const text = `${form.title} 서명 요청입니다. 링크를 열고 확인 후 서명해 주세요.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: form.title, text, url: shareUrl });
        return;
      }
    } catch {
      return; // 사용자가 취소했다
    }
    void copyLink();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("복사하지 못했습니다. 주소를 길게 눌러 직접 복사해 주세요.");
    }
  };

  /** 현장에서 바로 받은 서명 → PDF */
  async function downloadHere() {
    if (!cert || !form) return;
    const png = padRef.current?.toPng();
    if (!(confirmer.confirmerName ?? "").trim()) return setError("확인자 성명을 적어주세요.");
    if (!png) return setError("서명란에 서명해 주세요.");
    const bad = checkPrintable(...Object.values(values), ...Object.values(confirmer));
    if (bad) return setError(bad);

    setBusy(true);
    setError(null);
    try {
      const { buildCertPdf, fileNameFor } = await pdfModule();
      const doc = {
        cert,
        form,
        values,
        confirmerOrg: (confirmer.confirmerOrg ?? "").trim(),
        confirmerName: (confirmer.confirmerName ?? "").trim(),
        signaturePng: png,
        createdAt: new Date(),
      };
      const blob = await buildCertPdf(doc);
      const name = fileNameFor(doc);
      if (!(await sharePdfFile(blob, name))) downloadBlob(blob, name);

      rememberMe(values);
      saveDoc({
        id: docId || newId(),
        certId: cert.id,
        formId: form.id,
        variant,
        values,
        status: "SIGNED",
        createdAt: doc.createdAt.toISOString(),
        confirmerOrg: doc.confirmerOrg,
        confirmerName: doc.confirmerName,
        signaturePng: png,
      });
      countGenerated(cert.id, "here");
      setAsk(shouldAsk("maker") ? "maker" : null);
      setMode("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF를 만들지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  /** 링크를 받은 화주가 서명 → PDF. 이 폰에는 아무것도 저장하지 않는다. */
  async function signAsGuest() {
    if (!guest) return;
    const png = padRef.current?.toPng();
    if (!(confirmer.confirmerName ?? "").trim()) return setError("확인자 성명을 적어주세요.");
    if (!png) return setError("서명란에 서명해 주세요.");
    const bad = checkPrintable(...Object.values(confirmer));
    if (bad) return setError(bad);

    setBusy(true);
    setError(null);
    try {
      const { buildCertPdf, fileNameFor } = await pdfModule();
      const doc = {
        cert: guest.cert,
        form: guest.form,
        values,
        confirmerOrg: (confirmer.confirmerOrg ?? "").trim(),
        confirmerName: (confirmer.confirmerName ?? "").trim(),
        signaturePng: png,
        createdAt: new Date(),
      };
      const blob = await buildCertPdf(doc);
      setGuestPdf({ blob, name: fileNameFor(doc) });
      countGenerated(guest.cert.id, "link");
      setAsk(shouldAsk("signer") ? "signer" : null);
      setMode("guest-done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF를 만들지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function sendBackToDriver() {
    if (!guestPdf) return;
    if (!(await sharePdfFile(guestPdf.blob, guestPdf.name))) downloadBlob(guestPdf.blob, guestPdf.name);
  }

  async function reopen(record: DocRecord) {
    if (record.status === "REQUESTED") {
      const target = getCert(record.certId);
      setCertId(record.certId);
      setVariant(record.variant);
      setValues(record.values);
      setDocId(record.id);
      setShareUrl(requestUrl({ form: resolveForm(target, record.variant), values: record.values, from: record.values.carrierName || record.values.driverName || "" }));
      setMode("link");
      return;
    }
    if (!record.signaturePng) {
      setError("이 확인서의 서명 이미지가 이 폰에 남아 있지 않아 다시 만들 수 없습니다.");
      return;
    }
    setBusy(true);
    try {
      const { buildCertPdf, fileNameFor } = await pdfModule();
      const doc = {
        cert: getCert(record.certId),
        form: resolveForm(getCert(record.certId), record.variant),
        values: record.values,
        confirmerOrg: record.confirmerOrg ?? "",
        confirmerName: record.confirmerName ?? "",
        signaturePng: record.signaturePng,
        createdAt: new Date(record.createdAt),
      };
      const blob = await buildCertPdf(doc);
      const name = fileNameFor(doc);
      if (!(await sharePdfFile(blob, name))) downloadBlob(blob, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF를 다시 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const shownForm = guest?.form ?? form;
  const shownCert = guest?.cert ?? cert;

  const summaryRows = shownForm
    ? formFields(shownForm).map((field) => ({
        field,
        value: (values[field.key] ?? "").trim(),
      }))
    : [];

  const confirmerBlock = (
    <>
      <div className="sign-section">
        <h2>확인자</h2>
        {CONFIRMER_FIELDS.map((f) => (
          <div className="sign-field" key={f.key}>
            <label htmlFor={`f-${f.key}`}>{f.label}</label>
            <input
              id={`f-${f.key}`}
              type="text"
              autoComplete={f.key === "confirmerName" ? "name" : "organization"}
              value={confirmer[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setConfirmer((s) => ({ ...s, [f.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <div className="sign-section">
        <h2>서명</h2>
        <SignaturePad ref={padRef} onInkChange={setHasInk} />
      </div>
    </>
  );

  const statementBlock = shownForm && (
    <div className="sign-section">
      <h2>확인 내용</h2>
      <p className="hint" style={{ lineHeight: 1.65 }}>{shownForm.statement}</p>
      {shownForm.obligation && (
        <div style={{ marginTop: 14 }}>
          <div className="notice-unsupported">
            <div className="nu-title">서명 의무 조항</div>
            <div className="nu-body">{shownForm.obligation}</div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="sign-app">
      <div className="sign-scroll">
        {mode !== "home" && mode !== "guest" && mode !== "guest-done" && (
          <div className="bait-bar">
            <button type="button" className="back" onClick={goBack}>← 뒤로</button>
            <span className="crumb">{shownForm?.title ?? shownCert?.title}</span>
            <span className="step" />
          </div>
        )}

        {mode === "home" && (
          <>
            <div className="bait-head">
              <h1>안전운임 확인서 생성기</h1>
              <p>
                국토교통부 고시 별지 서식 그대로 폰에서 적고, 현장에서 서명받거나
                카톡으로 서명을 요청합니다. 가입도 설치도 없습니다.
              </p>
            </div>
            <div className="pick">
              {CERT_TYPES.map((c) => (
                <button key={c.id} type="button" onClick={() => startCert(c)}>
                  <span className="emoji" aria-hidden>{c.emoji}</span>
                  <span className="body">
                    <span className="t">{c.title}</span>
                    <span className="d">{c.desc}</span>
                  </span>
                  <span className="arrow" aria-hidden>›</span>
                </button>
              ))}
            </div>

            {docs.length > 0 && (
              <div className="sign-section" data-testid="doc-list">
                <h2>내가 만든 확인서</h2>
                <div className="doc-list">
                  {docs.slice(0, 8).map((record) => (
                    <div className="doc-row" key={record.id}>
                      <div className="doc-main">
                        <div className="doc-title">{record.values.siteName || "사업장 미기재"}</div>
                        <div className="doc-meta">
                          {shortDate(record.createdAt)}
                          {docSubtitle(record) ? ` · ${docSubtitle(record)}` : ""}
                        </div>
                      </div>
                      <span className={`doc-status s-${record.status.toLowerCase()}`}>
                        {STATUS_LABEL[record.status]}
                      </span>
                      <div className="doc-actions">
                        <button type="button" className="btn od-touch" onClick={() => void reopen(record)} disabled={busy}>
                          {record.status === "REQUESTED" ? "링크 다시 보내기" : "PDF"}
                        </button>
                        {record.status === "REQUESTED" && (
                          <button
                            type="button"
                            className="btn od-touch"
                            onClick={() => { updateDocStatus(record.id, "RECEIVED"); refreshDocs(); }}
                          >
                            받았음
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn od-touch"
                          aria-label="이 기록 지우기"
                          onClick={() => { removeDoc(record.id); refreshDocs(); }}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="hint" style={{ marginTop: 12 }}>
                  이 목록은 <strong>이 폰 안에만</strong> 있습니다. 서버로 보내지 않습니다.
                  브라우저 데이터를 지우면 함께 사라집니다.
                </p>
                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn od-touch"
                    onClick={() => {
                      if (window.confirm("이 폰에 저장된 확인서 기록과 차량 정보를 모두 지울까요? 되돌릴 수 없습니다.")) {
                        clearAll();
                        refreshDocs();
                      }
                    }}
                  >
                    이 폰에 저장된 기록 전부 지우기
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {mode === "form" && cert && form && (
          <>
            <div className="sign-section">
              <h2>{cert.pick.label}</h2>
              <div className="od-cluster" style={{ ["--od-gap" as string]: "8px" }} role="radiogroup" aria-label={cert.pick.label}>
                {cert.pick.variants.map((v) => (
                  <button
                    key={v.label}
                    type="button"
                    className={`btn od-touch ${variant === v.label ? "btn-primary" : ""}`}
                    style={{ minHeight: 46, fontSize: 16 }}
                    aria-pressed={variant === v.label}
                    onClick={() => changeVariant(v.label)}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              <p className="hint" style={{ marginTop: 10 }}>{form.no} · {form.title}</p>
            </div>

            <div className="sign-section">
              <h2>사업장 · 차량</h2>
              <div className="bait-grid">
                {form.header.map((f) => (
                  <FieldInput
                    key={f.key}
                    field={f}
                    value={values[f.key] ?? ""}
                    onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                  />
                ))}
              </div>
            </div>

            <div className="sign-section">
              <h2>{form.title}</h2>
              <div className="bait-grid">
                {form.body.map((f) => (
                  <FieldInput
                    key={f.key}
                    field={f}
                    value={values[f.key] ?? ""}
                    onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
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

        {mode === "sign" && cert && form && (
          <>
            {statementBlock}
            {confirmerBlock}
          </>
        )}

        {mode === "link" && form && (
          <div className="sign-section">
            <h2>서명 요청 링크</h2>
            <p className="hint" style={{ lineHeight: 1.65 }}>
              이 링크를 화주 담당자에게 보내세요. 링크를 열면 확인서 내용이 그대로 보이고,
              그 자리에서 서명할 수 있습니다. 가입도 설치도 필요 없습니다.
            </p>
            <div className="link-box" data-testid="share-url">{shareUrl}</div>
            <div className="od-row" style={{ ["--od-gap" as string]: "10px", marginTop: 12 }}>
              <button type="button" className="btn btn-primary od-touch" onClick={() => void shareLink()}>
                카톡 · 문자로 보내기
              </button>
              <button type="button" className="btn od-touch" onClick={() => void copyLink()}>
                {copied ? "복사됨" : "링크 복사"}
              </button>
            </div>
            <div style={{ marginTop: 18 }}>
              <div className="notice-unsupported">
                <div className="nu-title">알아두실 것</div>
                <div className="nu-body">
                  확인서 내용이 링크 주소 안에 들어 있습니다. 서버에 저장하지 않기 때문입니다.
                  링크를 받은 사람은 내용을 볼 수 있으니 서명할 분에게만 보내세요.
                  <br />
                  화주가 서명하면 <strong>PDF를 기사님께 다시 보내주어야</strong> 합니다. 서버가 없어서
                  자동으로 전달되지 않습니다.
                </div>
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <button type="button" className="btn btn-lg" onClick={goHome}>목록으로</button>
            </div>
          </div>
        )}

        {mode === "guest" && guest && (
          <>
            <div className="bait-head">
              <p className="sign-from">{guest.from ? `${guest.from} 요청` : "서명 요청"}</p>
              <h1>{guest.form.title}</h1>
              <p>아래 내용을 확인하시고 맞으면 서명해 주세요. 가입도 설치도 필요 없습니다.</p>
            </div>

            <div className="sign-section">
              <h2>{guest.form.no}</h2>
              <div className="doc-summary">
                {summaryRows.map(({ field, value }) => (
                  <div className="ds-row" key={field.key}>
                    <span className="ds-label">{field.label}</span>
                    <span className={`ds-value${value ? "" : " empty"}`}>
                      {!value
                        ? "(미기재)"
                        : field.type === "checks" || field.type === "radio"
                          ? splitPicked(value).join(", ")
                          : field.type === "datetime"
                            // 서명하는 사람에게 2026-03-09T11:20을 보여주면 안 된다.
                            ? formatFormDateTime(value)
                            : value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {statementBlock}
            {confirmerBlock}
          </>
        )}

        {mode === "guest-done" && guest && (
          <div className="sign-state" style={{ minHeight: "auto", padding: "40px 0" }}>
            <span className="st-mark ok" aria-hidden>
              <svg viewBox="0 0 24 24"><path d="M5 13l4.5 4.5L19 7" /></svg>
            </span>
            <h1>서명이 끝났습니다</h1>
            <p className="st-body">
              {guest.form.title} PDF가 만들어졌습니다.
              <br />
              <strong>요청하신 분께 보내주셔야</strong> 완료됩니다.
            </p>
            <div className="st-actions">
              <button type="button" className="btn btn-primary btn-lg" onClick={() => void sendBackToDriver()}>
                PDF 보내기 · 내려받기
              </button>
            </div>
            {ask === "signer" && <SurveyCard set="signer" onClose={() => setAsk(null)} />}
          </div>
        )}

        {mode === "done" && form && (
          <div className="sign-state" style={{ minHeight: "auto", padding: "40px 0" }}>
            <span className="st-mark ok" aria-hidden>
              <svg viewBox="0 0 24 24"><path d="M5 13l4.5 4.5L19 7" /></svg>
            </span>
            <h1>PDF가 만들어졌습니다</h1>
            <p className="st-body">{form.title} · 내려받기 폴더 또는 공유한 곳을 확인해 주세요.</p>
            <div className="st-actions">
              <button type="button" className="btn btn-primary btn-lg" onClick={goHome}>
                확인서 하나 더 만들기
              </button>
            </div>
            {ask === "maker" && <SurveyCard set="maker" onClose={() => setAsk(null)} />}
          </div>
        )}

        {mode === "home" && (
          <p className="sign-foot" style={{ padding: "28px 0 0" }}>
            입력한 내용과 서명은 이 브라우저 안에서만 처리됩니다. 서버로 보내지 않습니다.
            기록은 이 폰 안에만 남고, 언제든 위에서 지울 수 있습니다.
            <br />{DISCLAIMER}
          </p>
        )}
      </div>

      {(mode === "form" || mode === "sign" || mode === "guest") && (
        <div className="sign-actionbar">
          {mode === "form" ? (
            <>
              <button type="button" className="btn btn-primary btn-lg" onClick={goToSign}>
                여기서 서명받기
              </button>
              <button type="button" className="btn btn-lg" style={{ marginTop: 10 }} onClick={makeLink}>
                카톡으로 서명 요청
              </button>
            </>
          ) : mode === "sign" ? (
            <button type="button" className="btn btn-primary btn-lg" onClick={() => void downloadHere()} disabled={busy}>
              {busy ? "만드는 중…" : "서명 완료 · PDF 만들기"}
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-lg" onClick={() => void signAsGuest()} disabled={busy}>
              {busy ? "만드는 중…" : "서명 완료 · PDF 만들기"}
            </button>
          )}
          {error ? (
            <p className="why" style={{ color: "var(--miss)", fontWeight: 600 }}>{error}</p>
          ) : (
            (mode === "sign" || mode === "guest") && !hasInk && <p className="why">서명을 하면 PDF를 만들 수 있습니다.</p>
          )}
        </div>
      )}

      {(mode === "done" || mode === "guest-done") && (
        <p className="sign-foot">
          {DISCLAIMER}
          <br />입력값은 서버에 남지 않습니다.
        </p>
      )}
    </div>
  );
}
