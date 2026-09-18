import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "운임근거함",
  description: "운송 한 건에 붙는 증빙을 요청하고, 받고, 빠뜨린 걸 찾습니다.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* 글꼴은 globals.css의 @font-face로 자체 호스팅한다. 먼저 받아두게만 한다. */}
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
