import Link from "next/link";

export const metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <Link href="/" className="text-sm text-muted hover:text-text transition-colors">
        ← Back
      </Link>
      <h1 className="font-sora text-2xl font-semibold text-text mt-6 mb-4">
        Privacy Policy
      </h1>
      <p className="text-muted text-sm leading-relaxed mb-4">
        This is placeholder content. Replace this page with StudyFlow&apos;s
        actual privacy policy before accepting real users — it should cover
        what&apos;s collected (account details, uploaded briefs, usage data),
        how Supabase, OpenAI, and Stripe process that data on StudyFlow&apos;s
        behalf, and how someone can request deletion (see Settings → Delete
        account).
      </p>
      <p className="text-dim text-xs">Last updated: placeholder.</p>
    </div>
  );
}
