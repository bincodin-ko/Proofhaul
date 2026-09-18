import Link from "next/link";
import { logoutAction } from "@/app/actions";

export type NavKey = "shipments" | "new";

interface Props {
  companyName: string;
  userName: string;
  current?: NavKey;
  children: React.ReactNode;
}

/**
 * 관리 화면 셸. 왼쪽 사이드바 + 본문.
 *
 * 화면이 좁아지면 사이드바가 위쪽 가로 막대로 바뀐다 (globals.css의 반응형).
 * 사무실 데스크톱이 기본이지만 태블릿에서도 열린다.
 */
export default function Shell({ companyName, userName, current, children }: Props) {
  const items: { href: string; label: string; key: NavKey }[] = [
    { href: "/shipments", label: "운송 건", key: "shipments" },
    { href: "/shipments/new", label: "새 운송 건", key: "new" },
  ];

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="주 메뉴">
        <div className="brand">
          <span className="bname">운임근거함</span>
          <span className="borg">{companyName}</span>
        </div>
        <div className="nav">
          {items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={current === item.key ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <div className="side-foot">
          <span>{userName}</span>
          <form action={logoutAction}>
            <button type="submit">로그아웃</button>
          </form>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
