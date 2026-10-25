import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import { headers } from "next/headers";
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
    default: "Duecourse — Personal Study Planner",
    template: "%s | Duecourse",
  },
  description:
    "AI-powered study planner that breaks your assignments into tasks and schedules them around your life.",
  robots: { index: true, follow: true },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Duecourse — Personal Study Planner",
    description:
      "AI-powered study planner that breaks your assignments into tasks and schedules them around your life.",
    url: "/",
    siteName: "Duecourse",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Duecourse — Personal Study Planner",
    description:
      "AI-powered study planner that breaks your assignments into tasks and schedules them around your life.",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Reading the per-request nonce (set in src/middleware.ts) is what lets
  // Next.js tag its own generated scripts with it, matching the CSP header
  // on the same response -- see the comment in middleware.ts. Calling
  // headers() here also has a necessary side effect: it opts this layout,
  // and everything under it, out of static prerendering. That's required,
  // not just a side benefit -- a statically prerendered page has no
  // "current request" to pull a fresh nonce from, so without this, pages
  // Next would otherwise try to pre-render at build time would ship with no
  // matching nonce and get their scripts silently blocked by the CSP.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable}`}
      data-csp-nonce={nonce}
    >
      <body className="bg-navy font-sans text-text antialiased">
        {children}
      </body>
    </html>
  );
}
