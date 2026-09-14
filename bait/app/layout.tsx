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
  themeColor: "#12161c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
