"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center h-[calc(100vh-56px)] px-4">
      <div className="text-center max-w-sm">
        <p className="font-sora text-5xl font-bold text-red mb-4">!</p>
        <h1 className="font-sora text-xl font-semibold text-text mb-2">
          Something went wrong
        </h1>
        <p className="text-muted text-sm mb-6 leading-relaxed">
          An unexpected error occurred on this page. Your data is safe — try
          refreshing or going back to the dashboard.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="bg-indigo hover:bg-il text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="border border-border hover:border-indigo/50 text-muted hover:text-text text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
          >
            Back to calendar
          </Link>
        </div>
      </div>
    </div>
  );
}