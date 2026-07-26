import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-navy flex flex-col">
      <header className="p-6">
        <Link
          href="/"
          className="font-sora text-xl font-semibold text-text hover:text-il transition-colors"
        >
          Study<span className="text-il">Flow</span>
        </Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        {children}
      </main>
      <footer className="p-6 text-center text-dim text-sm">
        © {new Date().getFullYear()} StudyFlow
      </footer>
    </div>
  );
}