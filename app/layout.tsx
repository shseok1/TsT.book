import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Textbook — 텍스트를 전자책으로",
  description: "긴 텍스트를 그대로 담아 PDF 전자책으로 만드는 도구",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
