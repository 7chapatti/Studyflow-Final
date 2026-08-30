import Link from "next/link";

export const metadata = {
  title: "Terms of Service",
};

export default function TermsPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <Link href="/" className="text-sm text-muted hover:text-text transition-colors">
        ← Back
      </Link>
      <h1 className="font-sora text-2xl font-semibold text-text mt-6 mb-4">
        Terms of Service
      </h1>
      <p className="text-muted text-sm leading-relaxed mb-4">
        This is placeholder content. Replace this page with StudyFlow&apos;s
        actual terms of service before accepting real users — the signup
        flow links here and asks people to agree to it.
      </p>
      <p className="text-dim text-xs">Last updated: placeholder.</p>
    </div>
  );
}
