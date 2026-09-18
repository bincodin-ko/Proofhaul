import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "안전운임 확인서 생성기",
  description:
    "대기시간 · 험로/오지 · 세척/손상교체 확인서를 폰에서 작성하고, 손가락으로 서명받아 PDF로 내려받습니다. 가입 없음.",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#15181B",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* 글꼴은 globals.css의 @font-face로 자체 호스팅한다 — CSP에 외부 호스트를 뚫지 않는다. */}
        <link
          rel="preload"
          href="/fonts/PretendardVariable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
