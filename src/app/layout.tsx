import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
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
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable}`}>
      <body className="bg-navy font-sans text-text antialiased">
        {children}
      </body>
    </html>
  );
}
