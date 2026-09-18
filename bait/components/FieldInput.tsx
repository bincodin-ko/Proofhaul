"use client";

import type { Field } from "@/lib/certs";

interface Props {
  field: Field;
  value: string;
  onChange: (value: string) => void;
}

/** 모든 값은 문자열로 다룬다. 다중 선택은 ", "로 이어 붙인다. */
export default function FieldInput({ field, value, onChange }: Props) {
  const id = `f-${field.key}`;
  const wide = field.wide ? "span-2" : "";

  if (field.type === "checks" || field.type === "radio") {
    const selected = value ? value.split(", ").filter(Boolean) : [];
    const multi = field.type === "checks";
    const toggle = (option: string) => {
      if (!multi) return onChange(selected[0] === option ? "" : option);
      const next = selected.includes(option)
        ? selected.filter((s) => s !== option)
        : [...(field.options ?? []).filter((o) => selected.includes(o) || o === option)];
      onChange(next.join(", "));
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
          type={field.type}
          step={field.type === "time" ? 300 : undefined}
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
