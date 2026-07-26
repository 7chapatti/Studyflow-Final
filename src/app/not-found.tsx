import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-navy flex items-center justify-center px-4">
      <div className="text-center">
        <p className="font-sora text-6xl font-bold text-indigo mb-4">404</p>
        <h1 className="font-sora text-2xl font-semibold text-text mb-2">
          Page not found
        </h1>
        <p className="text-muted text-sm mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="bg-indigo hover:bg-il text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
          >
            Go to dashboard
          </Link>
          <Link
            href="/"
            className="border border-border hover:border-indigo/50 text-muted hover:text-text text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}