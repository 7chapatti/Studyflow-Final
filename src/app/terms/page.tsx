import Link from "next/link";
import { LEGAL_LINKS } from "@/lib/legal";

export const metadata = {
  title: "Terms of Service",
};

export default function TermsPage() {
  const { termsUrl } = LEGAL_LINKS;

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
            Terms of Service
          </h1>

          {termsUrl ? (
            <>
              <p className="mb-4 text-sm leading-relaxed text-muted">
                These terms cover your StudyFlow account, the Free, Premium
                and Pro plans, billing and cancellation, and acceptable use
                of the service.
              </p>
              <p className="text-sm">
                <Link
                  href={termsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-il underline transition-colors hover:text-text"
                >
                  View the full Terms of Service ↗
                </Link>
              </p>
            </>
          ) : (
            <p className="text-sm leading-relaxed text-muted">
              StudyFlow&apos;s Terms of Service are being finalised and
              aren&apos;t published yet. The signup flow will link here once
              they&apos;re live — for now, contact StudyFlow directly with
              any questions.
            </p>
          )}
        </article>
      </main>
    </>
  );
}
