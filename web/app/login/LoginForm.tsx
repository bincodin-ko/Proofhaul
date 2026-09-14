"use client";

import { useActionState } from "react";
import { loginAction, type LoginFormState } from "./actions";

const INITIAL: LoginFormState = { message: null };

export default function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, INITIAL);

  return (
    <form action={action} className="card">
      <div className="field">
        <label htmlFor="email">이메일</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
        />
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
      <button type="submit" className="primary" disabled={pending}>
        {pending ? "확인 중…" : "로그인"}
      </button>
      {/* 없는 계정과 틀린 비밀번호에 같은 문구가 나온다. */}
      {state.message && <p className="error">{state.message}</p>}
    </form>
  );
}
