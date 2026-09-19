"use client";

import { joinPicked, splitPicked, type Field } from "@/lib/certs";

interface Props {
  field: Field;
  value: string;
  onChange: (value: string) => void;
}

/** 모든 값은 문자열로 다룬다. 다중 선택은 MULTI_SEP로 이어 붙인다. */
export default function FieldInput({ field, value, onChange }: Props) {
  const id = `f-${field.key}`;
  const wide = field.wide ? "span-2" : "";

  if (field.type === "checks" || field.type === "radio") {
    const selected = splitPicked(value);
    const multi = field.type === "checks";
    const toggle = (option: string) => {
      if (!multi) return onChange(selected[0] === option ? "" : option);
      const next = selected.includes(option)
        ? selected.filter((s) => s !== option)
        : (field.options ?? []).filter((o) => selected.includes(o) || o === option);
      onChange(joinPicked(next));
    };
    return (
      <div className={`sign-field ${wide}`}>
        <label>{field.label}</label>
        <div
          className="od-cluster"
          style={{ ["--od-gap" as string]: "8px" }}
          role={multi ? "group" : "radiogroup"}
          aria-label={field.label}
        >
          {(field.options ?? []).map((option) => (
            <button
              key={option}
              type="button"
              className={`btn od-touch ${selected.includes(option) ? "btn-primary" : ""}`}
              style={{ minHeight: 46, fontSize: 16 }}
              aria-pressed={selected.includes(option)}
              onClick={() => toggle(option)}
            >
              {option}
            </button>
          ))}
        </div>
        {field.hint && <span className="hint">{field.hint}</span>}
      </div>
    );
  }

  return (
    <div className={`sign-field ${wide}`}>
      <label htmlFor={id}>{field.label}</label>
      {field.type === "textarea" ? (
        <textarea
          id={id}
          rows={2}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          // 서식은 시각을 "2026년 __월 __일 __시 __분"으로 받는다. 시:분만 받으면
          // 날짜가 바뀌는 대기(야간 상차 등)를 적을 수 없다.
          type={field.type === "datetime" ? "datetime-local" : field.type}
          step={field.type === "datetime" ? 60 : undefined}
          value={value}
          placeholder={field.placeholder}
          inputMode={field.type === "tel" ? "tel" : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.hint && <span className="hint">{field.hint}</span>}
    </div>
  );
}
