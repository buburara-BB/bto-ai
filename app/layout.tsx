import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BTO-AI Finder",
  description: "自然言語でBTOパソコンを探す／自作PCの落とし穴をAIが辛口診断",
};
export const viewport: Viewport = { themeColor: "#020617" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
