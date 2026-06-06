import type { Metadata } from "next";
import { Syne } from "next/font/google";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "700", "800"],
});

export const metadata: Metadata = {
  title: "COLOR REPLACER — Brutalist Recolor Tool",
  description: "Luminance-preserving dome color replacement",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={syne.className}>
      <body className="min-h-screen flex flex-col" style={{ background: "#0a0a0a", color: "#f0f0f0" }}>
        {children}
      </body>
    </html>
  );
}
