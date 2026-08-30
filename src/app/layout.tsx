import type { Metadata } from "next";
import { Sora, Inter } from "next/font/google";
import "./globals.css";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  // Required for Next to resolve the relative OG/Twitter image paths below
  // into absolute URLs -- without it, social platforms that can't resolve
  // a relative URL just show no preview image at all.
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "StudyFlow — Personal Study Planner",
    template: "%s | StudyFlow",
  },
  description:
    "AI-powered study planner that breaks your assignments into tasks and schedules them around your life.",
  robots: { index: true, follow: true },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "StudyFlow — Personal Study Planner",
    description:
      "AI-powered study planner that breaks your assignments into tasks and schedules them around your life.",
    url: "/",
    siteName: "StudyFlow",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "StudyFlow — Personal Study Planner",
    description:
      "AI-powered study planner that breaks your assignments into tasks and schedules them around your life.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sora.variable} ${inter.variable}`}>
      <body className="bg-navy text-text antialiased">
        {children}
      </body>
    </html>
  );
}
