import { CARGO_LABEL } from "@/lib/cargo";
import { KINDS } from "@/lib/evidence-kind";
import { requestIp } from "@/lib/request";
import { lookupByToken } from "@/lib/token";
import { rulesFor } from "@/rules/index";
import SignForm from "./SignForm";

export const metadata = {
  title: "증빙 서명",
  // 서명 링크가 검색에 잡히면 안 된다.
  robots: { index: false, follow: false, nocache: true },
};

function Mark({ tone }: { tone: "ok" | "warn" | "stop" }) {
  const paths: Record<typeof tone, React.ReactNode> = {
    ok: <path d="M5 13l4.5 4.5L19 7" />,
    warn: (<><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>),
    stop: (<><path d="M12 8v5M12 16h.01" /><path d="M4.5 19h15L12 5z" /></>),
  };
  return (
    <span className={`st-mark ${tone}`} aria-hidden>
      <svg viewBox="0 0 24 24">{paths[tone]}</svg>
    </span>
  );
}

/** 없는 토큰과 만료된 토큰이 **같은 화면**을 본다 (05-SECURITY 위협 1). */
function Gone() {
  return (
    <div className="sign-state">
      <Mark tone="warn" />
      <h1>열 수 없는 링크입니다</h1>
      <p className="st-body">기한이 지났거나 주소가 잘못되었습니다.</p>
      <div className="st-meta">
        <strong style={{ display: "block", color: "var(--ink)" }}>다음에 하실 일</strong>
        요청을 보낸 운송사에 <strong>재발송을 부탁</strong>하세요. 새 링크를 받으면 바로 서명하실 수 있습니다.
      </div>
      <p className="st-foot">이 화면에서는 아무 정보도 보여드리지 않습니다.</p>
    </div>
  );
}

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await lookupByToken(decodeURIComponent(token), await requestIp());

  if (result.state === "throttled") {
    return (
      <div className="sign-state">
        <Mark tone="warn" />
        <h1>잠시 후 다시 열어 주세요</h1>
        <p className="st-body">짧은 시간에 너무 많이 열렸습니다. 1분쯤 뒤에 같은 링크를 다시 열면 됩니다.</p>
        <p className="st-foot">계속 열리지 않으면 요청한 운송사에 알려 주세요.</p>
      </div>
    );
  }

  if (result.state === "signed") {
    return (
      <div className="sign-state">
        <Mark tone="ok" />
        <h1>이미 서명이 끝났습니다</h1>
        <p className="st-body">
          이 링크로는 더 이상 입력할 수 없습니다. 내용은 요청한 운송사에 전달되었습니다.
        </p>
        <p className="st-foot">내용을 다시 확인하시려면 요청한 운송사에 알려 주세요.</p>
      </div>
    );
  }

  if (result.state !== "ok") return <Gone />;

  const view = result.view;
  const spec = KINDS[view.kind];

  // 계산 규칙이 확정되기 전까지 초과 시간을 계산하지 않는다. 화면에 "미지원"이 뜬다.
  const rules = rulesFor(view.shippedOn);
  const waitSupported = rules?.waitThreshold(view.cargoType) !== null && rules !== null;

  return (
    <SignForm
      token={decodeURIComponent(token)}
      kind={view.kind}
      title={spec.title}
      companyName={view.companyName}
      shippedOn={view.shippedOn}
      cargoLabel={CARGO_LABEL[view.cargoType]}
      waitSupported={waitSupported}
    />
  );
}
