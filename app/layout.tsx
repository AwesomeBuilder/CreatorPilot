import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Sora, Noto_Sans } from "next/font/google";

import "./globals.css";
import { cn } from "@/lib/utils";

const notoSans = Noto_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const bodyFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-body",
});

const displayFont = Sora({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "Creator Pilot",
  description: "AI agent that turns trends and creator media into YouTube-ready videos.",
  icons: {
    icon: "/creator-pilot-logo.svg",
    shortcut: "/creator-pilot-logo.svg",
    apple: "/creator-pilot-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("font-sans", notoSans.variable)}>
      <body className={`${bodyFont.variable} ${displayFont.variable} min-h-screen antialiased`}>{children}</body>
    </html>
  );
}
