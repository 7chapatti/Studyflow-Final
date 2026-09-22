import Link from "next/link";
import { LEGAL_LINKS } from "@/lib/legal";

export const metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPage() {
  const { privacyPolicyUrl } = LEGAL_LINKS;

  return (
    <>
      <header className="mx-auto w-full max-w-2xl px-6 pt-16">
        <Link href="/" className="text-sm text-muted transition-colors hover:text-text">
          ← Back
        </Link>
      </header>

      <main className="mx-auto w-full max-w-2xl px-6 pb-16">
        <article>
          <h1 className="font-display mt-6 mb-4 text-2xl font-semibold text-text">
            Privacy Policy
          </h1>

          {privacyPolicyUrl ? (
            <>
              <p className="mb-4 text-sm leading-relaxed text-muted">
                StudyFlow&apos;s Privacy &amp; Cookie Policy covers what account
                and assignment data is collected, which services process it
                on StudyFlow&apos;s behalf, and how to request deletion of
                your data.
              </p>
              <p className="text-sm">
                <Link
                  href={privacyPolicyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-il underline transition-colors hover:text-text"
                >
                  View the full Privacy &amp; Cookie Policy ↗
                </Link>
              </p>
            </>
          ) : (
            <p className="text-sm leading-relaxed text-muted">
              StudyFlow&apos;s Privacy &amp; Cookie Policy is being finalised
              and isn&apos;t published yet. Check back shortly, or contact
              StudyFlow directly with any questions about how your data is
              handled.
            </p>
          )}
        </article>
      </main>
    </>
  );
}
