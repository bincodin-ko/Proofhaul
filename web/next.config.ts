import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // 개발용 떠다니는 배지. 화면 아래쪽 버튼을 가려서 끈다.
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // HTTPS 강제 (05-SECURITY "기본 위생").
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
