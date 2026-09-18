"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { CARGO_LABEL } from "@/lib/cargo";
import {
  FIELDS, FIELD_LABEL, MAX_ROWS, parsePaste, toDrafts,
  type Field, type ParsedGrid, type ShipmentDraft,
} from "@/lib/paste";
import { importShipmentsAction } from "../actions";

const PREVIEW_ROWS = 30;

/** 읽힌 줄은 저장될 값을, 못 읽은 줄은 원본 글자를 보여준다. */
function cellText(field: Field | null, draft: ShipmentDraft | null, raw: string): string {
  if (!field || !draft) return raw;
  if (field === "cargo_type") return CARGO_LABEL[draft.cargo_type];
  return draft[field];
}

export default function PasteImport() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedGrid | null>(null);
  const [mapping, setMapping] = useState<(Field | null)[]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleText(next: string) {
    setText(next);
    setError(null);
    if (!next.trim()) return setParsed(null);
    try {
      const result = parsePaste(next);
      setParsed(result);
      setMapping(result.mapping);
      setHasHeader(result.looksLikeHeader);
    } catch (e) {
      setParsed(null);
      setError(e instanceof Error ? e.message : "붙여넣은 내용을 읽지 못했습니다.");
    }
  }

  const results = useMemo(
    () => (parsed ? toDrafts(parsed.rows, mapping, hasHeader) : []),
    [parsed, mapping, hasHeader],
  );
  const ready = results.filter((r) => r.draft !== null);
  const failed = results.filter((r) => r.draft === null && r.errors.length > 0);

  function setColumn(index: number, field: Field | null) {
    setMapping((current) => {
      const next = [...current];
      if (field) next.forEach((f, i) => { if (f === field && i !== index) next[i] = null; });
      next[index] = field;
      return next;
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const outcome = await importShipmentsAction(ready.map((r) => r.draft!));
      if (outcome.message) return setError(outcome.message);
      router.push("/shipments");
      router.refresh();
    });
  }

  const header = parsed && hasHeader ? parsed.rows[0] : null;

  return (
    <div className="card">
      <div className="card-body">
        <div className="field">
          <label htmlFor="paste">엑셀에서 범위를 복사해 붙여넣으세요</label>
          <textarea
            id="paste"
            rows={5}
            value={text}
            placeholder={"운송일자\t품목\t출발지\t도착지\t차주\t연락처\t화주"}
            onChange={(e) => handleText(e.target.value)}
          />
          <span className="hint">
            첫 줄을 제목 줄로 짐작합니다. 틀리면 아래에서 고칠 수 있습니다. 한 번에 {MAX_ROWS}건까지.
          </span>
        </div>

        {error && (
          <div className="err-summary" role="alert" style={{ marginTop: 16, marginBottom: 0 }}>
            <h3>{error}</h3>
          </div>
        )}
      </div>

      {parsed && (
        <>
          <div className="card-head">
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                style={{ width: "auto", minHeight: 0 }}
              />
              첫 줄은 제목 줄입니다
            </label>
            <span className="badge badge-plain">
              {ready.length}건 가져옴 · {failed.length}건 제외
            </span>
          </div>

          {parsed.truncated && (
            <div className="card-body" style={{ paddingBottom: 0 }}>
              <div className="notice-unsupported">
                <div className="nu-title">{parsed.truncated.rows}줄이 잘렸습니다</div>
                <div className="nu-body">한 번에 {MAX_ROWS}건까지입니다. 나눠서 올려 주세요.</div>
              </div>
            </div>
          )}

          <div className="table-scroll">
            <table className="table preview-table">
              <thead>
                <tr>
                  <th className="num">줄</th>
                  {mapping.map((field, index) => (
                    <th key={index}>
                      <select
                        className="map-select"
                        aria-label={`${index + 1}번째 칼럼`}
                        value={field ?? ""}
                        onChange={(e) => setColumn(index, (e.target.value || null) as Field | null)}
                      >
                        <option value="">가져오지 않음</option>
                        {FIELDS.map((f) => (
                          <option key={f} value={f}>{FIELD_LABEL[f]}</option>
                        ))}
                      </select>
                      {header?.[index] && <span className="norm">{header[index]}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.slice(0, PREVIEW_ROWS).map((result) => {
                  const row = parsed.rows[result.lineNumber - 1];
                  return (
                    <tr key={result.lineNumber} className={result.errors.length ? "bad" : ""}>
                      <td className="num" style={{ color: "var(--ink-3)" }}>{result.lineNumber}</td>
                      {mapping.map((field, index) => (
                        <td key={index} style={field ? undefined : { color: "var(--ink-3)" }}>
                          {cellText(field, result.draft, row?.[index] ?? "")}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card-body">
            {results.length > PREVIEW_ROWS && (
              <p className="hint">앞 {PREVIEW_ROWS}줄만 보여줍니다. 가져오기는 전체가 대상입니다.</p>
            )}

            {failed.length > 0 && (
              <div className="err-summary" style={{ marginBottom: 0 }}>
                <h3>{failed.length}줄은 가져오지 않습니다</h3>
                <ul className="reason-list" style={{ padding: 0, listStyle: "none" }}>
                  {failed.slice(0, 10).map((r) => (
                    <li key={r.lineNumber}>
                      <span className="ln">{r.lineNumber}번째</span>
                      <span>{r.errors.join(" ")}</span>
                    </li>
                  ))}
                </ul>
                {failed.length > 10 && <p className="hint" style={{ marginTop: 8 }}>외 {failed.length - 10}줄</p>}
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <button
                className="btn btn-primary"
                type="button"
                style={{ minHeight: 42 }}
                onClick={submit}
                disabled={pending || ready.length === 0}
              >
                {pending ? "가져오는 중…" : `${ready.length}건 가져오기`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
