import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "InfluencePilot",
  description: "AI agent that turns trends and creator media into YouTube-ready videos.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-100 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
