import { CARGO_LABEL } from "@/lib/cargo";
import { KINDS } from "@/lib/evidence-kind";
import { requestIp } from "@/lib/request";
import { rulesFor } from "@/rules/index";
import { lookupByToken } from "@/lib/token";
import SignForm from "./SignForm";

export const metadata = {
  title: "증빙 서명",
  // 서명 링크가 검색에 잡히면 안 된다.
  robots: { index: false, follow: false, nocache: true },
};

/** 없는 토큰과 만료된 토큰이 **같은 화면**을 본다 (05-SECURITY 위협 1). */
function Gone() {
  return (
    <main className="sign">
      <div className="notice">
        <h1>만료되었거나 올바르지 않은 링크입니다</h1>
        <p>
          서명 링크는 발급 후 7일 동안만 열립니다. 요청하신 운송사에 재발송을 부탁해 주세요.
        </p>
      </div>
    </main>
  );
}

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await lookupByToken(decodeURIComponent(token), await requestIp());

  if (result.state === "throttled") {
    return (
      <main className="sign">
        <div className="notice">
          <h1>잠시 후 다시 열어 주세요</h1>
          <p>짧은 시간에 요청이 너무 많았습니다.</p>
        </div>
      </main>
    );
  }

  if (result.state === "signed") {
    return (
      <main className="sign">
        <div className="notice">
          <h1>이미 서명이 끝난 링크입니다</h1>
          <p>다시 서명할 수 없습니다. 수정이 필요하면 요청하신 운송사에 알려주세요.</p>
        </div>
      </main>
    );
  }

  if (result.state !== "ok") return <Gone />;

  const view = result.view;
  const spec = KINDS[view.kind];

  // 계산 규칙이 확정되기 전까지 초과 시간을 계산하지 않는다. 화면에는 "미지원"이 뜬다
  // (docs/06-FAST-TRACK.md "핵심 아이디어", docs/02-RULES-v2026.md 코드 반영 규칙 3항).
  const rules = rulesFor(view.shippedOn);
  const waitThreshold = rules?.waitThreshold(view.cargoType) ?? null;

  return (
    <main className="sign">
      {/* 서명 전 화면에 띄우는 정보는 최소한이다 — 운송 건, 날짜, 품목, 요청 회사명.
          차주 연락처·메모·다른 운송 건·금액은 여기 없다 (05-SECURITY 위협 1). */}
      <header className="sign-head">
        <p className="from">{view.companyName} 요청</p>
        <h1>{spec.title}</h1>
        <p className="about">
          {view.shippedOn} · {CARGO_LABEL[view.cargoType]}
        </p>
      </header>

      <SignForm
        token={decodeURIComponent(token)}
        kind={view.kind}
        waitSupported={waitThreshold !== null}
      />
    </main>
  );
}
