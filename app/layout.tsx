import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VoxStation",
  description: "Voice-enabled AI chat with local STT, LLM + RAG, and cloned voice TTS",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
