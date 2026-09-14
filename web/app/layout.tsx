import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "운임근거함",
  description: "운송 한 건에 붙는 증빙을 요청하고, 받고, 빠뜨린 걸 찾습니다.",
  // 로그인 뒤 화면이다. 검색에 걸릴 이유가 없다.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
