"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { CARGO_LABEL } from "@/lib/cargo";
import {
  FIELDS,
  FIELD_LABEL,
  MAX_ROWS,
  parsePaste,
  toDrafts,
  type Field,
  type ParsedGrid,
  type ShipmentDraft,
} from "@/lib/paste";
import { importShipmentsAction } from "../actions";

const PREVIEW_ROWS = 30;

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
    if (!next.trim()) {
      setParsed(null);
      return;
    }
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
      // 같은 필드를 두 칼럼에 둘 수 없다. 먼저 있던 쪽을 비운다.
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
  const preview = results.slice(0, PREVIEW_ROWS);

  return (
    <div className="card">
      <div className="field">
        <label htmlFor="paste">엑셀에서 범위를 복사해 붙여넣으세요</label>
        <textarea
          id="paste"
          rows={6}
          value={text}
          placeholder={"운송일자\t품목\t출발지\t도착지\t차주\t연락처\t화주"}
          onChange={(e) => handleText(e.target.value)}
        />
        <span className="hint">
          첫 줄을 제목 줄로 짐작합니다. 틀리면 아래에서 고칠 수 있습니다. 한 번에 {MAX_ROWS}건까지.
        </span>
      </div>

      {error && <p className="error">{error}</p>}

      {parsed && (
        <>
          {parsed.truncated && (
            <p className="warn">
              {parsed.truncated.rows}줄이 상한을 넘어 잘렸습니다. 나눠서 올려 주세요.
            </p>
          )}

          <label className="checkline">
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => setHasHeader(e.target.checked)}
            />
            첫 줄은 제목 줄입니다
          </label>

          <div className="table-wrap">
            <table className="preview">
              <thead>
                <tr>
                  <th className="num">줄</th>
                  {mapping.map((field, index) => (
                    <th key={index}>
                      <select
                        aria-label={`${index + 1}번째 칼럼`}
                        value={field ?? ""}
                        onChange={(e) => setColumn(index, (e.target.value || null) as Field | null)}
                      >
                        <option value="">가져오지 않음</option>
                        {FIELDS.map((f) => (
                          <option key={f} value={f}>{FIELD_LABEL[f]}</option>
                        ))}
                      </select>
                      {header?.[index] && <div className="orig">{header[index]}</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((result) => {
                  const row = parsed.rows[hasHeader ? result.lineNumber - 1 : result.lineNumber - 1];
                  return (
                    <tr key={result.lineNumber} className={result.errors.length ? "bad" : ""}>
                      <td className="num muted">{result.lineNumber}</td>
                      {mapping.map((field, index) => (
                        <td key={index} className={field ? "" : "skipped"}>
                          {/* 읽힌 줄은 저장될 값을 보여준다. 원본 글자가 아니라
                              "이렇게 들어갑니다"가 보여야 고칠 수 있다. */}
                          {cellText(field, result.draft, row?.[index] ?? "")}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {results.length > PREVIEW_ROWS && (
            <p className="hint">앞 {PREVIEW_ROWS}줄만 보여줍니다. 가져오기는 전체가 대상입니다.</p>
          )}

          {failed.length > 0 && (
            <div className="problems">
              <strong>{failed.length}줄은 가져오지 않습니다.</strong>
              <ul>
                {failed.slice(0, 10).map((r) => (
                  <li key={r.lineNumber}>
                    {r.lineNumber}번째 줄 — {r.errors.join(" ")}
                  </li>
                ))}
              </ul>
              {failed.length > 10 && <p className="hint">외 {failed.length - 10}줄</p>}
            </div>
          )}

          <button
            type="button"
            className="primary"
            onClick={submit}
            disabled={pending || ready.length === 0}
          >
            {pending ? "가져오는 중…" : `${ready.length}건 가져오기`}
          </button>
        </>
      )}
    </div>
  );
}
