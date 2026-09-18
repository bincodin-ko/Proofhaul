"use client";

import { useActionState } from "react";
import { loginAction, type LoginFormState } from "./actions";

const INITIAL: LoginFormState = { message: null };

export default function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, INITIAL);

  return (
    <form action={action} className="card" noValidate>
      <div className="card-body" style={{ display: "grid", gap: 16 }}>
        {/* 없는 계정과 틀린 비밀번호를 구분해 보여주지 않는다 — 항상 같은 한 줄 */}
        <div role="alert" aria-live="polite">
          {state.message && (
            <div className="err-summary" style={{ margin: 0 }}>
              <h3 style={{ fontWeight: 600 }}>{state.message}</h3>
            </div>
          )}
        </div>
        <div className="field">
          <label htmlFor="email">이메일</label>
          <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">비밀번호</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <button className="btn btn-primary" type="submit" style={{ minHeight: 42 }} disabled={pending}>
          {pending ? "확인 중…" : "로그인"}
        </button>
      </div>
    </form>
  );
}
