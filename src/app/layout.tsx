import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "배달이익노트",
  description: "배민 주문 한 건과 선택 기간에 실제로 얼마가 남는지 계산하는 도구",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
