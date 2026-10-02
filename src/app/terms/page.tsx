import Link from "next/link";

export const metadata = {
  title: "Terms of Service",
};

const LAST_UPDATED = "2 October 2026";

export default function TermsPage() {
  return (
    <>
      <header className="mx-auto w-full max-w-2xl px-6 pt-16">
        <Link href="/" className="text-sm text-muted transition-colors hover:text-text">
          ← Back
        </Link>
      </header>

      <main className="mx-auto w-full max-w-2xl px-6 pb-16">
        <article>
          <h1 className="font-display mt-6 mb-1 text-2xl font-semibold text-text">
            Terms of Service
          </h1>
          <p className="mb-8 text-xs text-dim">
            Last updated <time dateTime="2026-10-02">{LAST_UPDATED}</time>
          </p>

          <section className="mb-7">
            <h2 className="font-display mb-2 text-base font-semibold text-text">
              1. Who these terms are with
            </h2>
            <p className="text-sm leading-relaxed text-muted">
              StudyFlow is operated by Astrape, 66 Hampton Road, Birmingham B6
              6AB, United Kingdom (&quot;StudyFlow&quot;, &quot;we&quot;,
              &quot;us&quot;). By creating an account or using StudyFlow you
              agree to these terms. If you don&apos;t agree to them, please
              don&apos;t use the service.
            </p>
          </section>

          <section className="mb-7">
            <h2 className="font-display mb-2 text-base font-semibold text-text">
              2. What StudyFlow does
            </h2>
            <p className="mb-3 text-sm leading-relaxed text-muted">
              StudyFlow reads an assignment brief you upload or describe,
              breaks it into tasks, estimates how long each will take, and
              schedules time for them around your other commitments.
            </p>
            <p className="text-sm leading-relaxed text-muted">
              <strong className="font-medium text-text">
                The breakdown, time estimates and schedule are suggestions,
                not guarantees.
              </strong>{" "}
              StudyFlow uses an AI model to read your brief, and AI can
              misread requirements or miss details. You&apos;re responsible
              for checking the actual assignment brief yourself and for
              meeting your own deadlines — don&apos;t rely on StudyFlow as
              your only source of truth for what&apos;s actually required.
            </p>
          </section>

          <section className="mb-7">
            <h2 className="font-display mb-2 text-base font-semibold text-text">
              3. Your account
            </h2>
            <p className="mb-3 text-sm leading-relaxed text-muted">
              You need to be at least 16 years old to create a StudyFlow
              account, or have a parent or guardian&apos;s permission if
              you&apos;re younger. You&apos;re responsible for the
              information you give us being accurate, and for keeping your
              login details to yourself.
            </p>
            <p className="text-sm leading-relaxed text-muted">
              You can delete your account at any time from Settings. This
              permanently removes your assignments, tasks, blocked times and
              schedule — there&apos;s no recovering it afterwards, so make
              sure that&apos;s what you want first.
            </p>
          </section>

          <section className="mb-7">
            <h2 className="font-display mb-2 text-base font-semibold text-text">
              4. Plans and limits
            </h2>
            <p className="mb-3 text-sm leading-relaxed text-muted">
              StudyFlow is free to start, with paid plans for people juggling
              more assignments:
            </p>
            <ul className="mb-3 space-y-1.5 text-sm text-muted">
              <li>
                <strong className="font-medium text-text">Free</strong> — up
                to 2 active assignments and 3 AI analyses a month.
              </li>
              <li>
                <strong className="font-medium text-text">Premium</strong> —
                £4.99/month (or £47.99/year), up to 20 active assignments and
                50 AI analyses a month.
              </li>
              <li>
                <strong className="font-medium text-text">Pro</strong> —
                £9.99/month (or £95.99/year), up to 100 active assignments
                and 200 AI analyses a month.
              </li>
            </ul>
            <p className="text-sm leading-relaxed text-muted">
              We may change these limits or prices in the future. If we do,
              we&apos;ll let existing subscribers know before any price change
              affects them.
            </p>
          </section>

          <section className="mb-7">
            <h2 className="font-display mb-2 text-base font-semibold text-text">
              5. Payment, cancellation and refunds
            </h2>
            <p className="mb-3 text-sm leading-relaxed text-muted">
              Paid plans are billed monthly or yearly through Stripe, our
              payment processor, and renew automatically until you cancel.
              You can cancel any time from Settings — your plan stays active
              until the end of the period you&apos;ve already paid for, and
              it won&apos;t renew after that.
            </p>
            <p className="text-sm leading-relaxed text-muted">
              All paid plans include a{" "}
              <strong className="font-medium text-text">
                14-day money-back guarantee
              </strong>
              . If StudyFlow isn&apos;t right for you, contact us within 14
              days of being charged and we&apos;ll refund that payment.
            </p>
          </section>

          <section className="mb-7">
            <h2 className="font-display mb-2 text-base font-semibold text-text">
              6. Acceptable use
            </h2>
            <p className="text-sm leading-relaxed text-muted">
              Please don&apos;t use StudyFlow to upload content you don&apos;t
              have the right to use, try to get around the plan limits above,
              scrape or automate access to the service, or attempt to
              interfere with how it runs for other people.
            </p>
          </section>

          <section className="mb-7">
            <h2 className="font-display mb-2 text-base font-semibold text-text">
              7. Your content
            </h2>
            <p className="text-sm leading-relaxed text-muted">
              Whatever you upload or write in StudyFlow — assignment briefs,
              task notes, and so on — stays yours. By using StudyFlow you give
              us permission to store and process that content for the sole
              purpose of running the service for you, including sending it to
              OpenAI to generate the task breakdown and estimates.
            </p>
          </section>

          <section className="mb-7">
            <h2 className="font-display mb-2 text-base font-semibold text-text">
              8. Academic integrity
            </h2>
            <p className="text-sm leading-relaxed text-muted">
              StudyFlow plans your work; it doesn&apos;t do it for you. The
              breakdown, estimates and scheduling are there to help you
              organise your own time. You&apos;re responsible for following
              your institution&apos;s academic integrity rules in how you
              actually complete your assignments.
            </p>
          </section>

          <section className="mb-7">
            <h2 className="font-display mb-2 text-base font-semibold text-text">
              9. Liability and availability
            </h2>
            <p className="mb-3 text-sm leading-relaxed text-muted">
              StudyFlow is provided &quot;as is&quot;. We do our best to keep
              it available and accurate, but we don&apos;t promise it will be
              uninterrupted, error-free, or that its AI-generated suggestions
              will be correct. To the fullest extent the law allows, we&apos;re
              not liable for missed deadlines, lost work, or other losses
              arising from your use of StudyFlow.
            </p>
            <p className="text-sm leading-relaxed text-muted">
              Nothing in these terms limits our liability where it would be
              unlawful to do so, including for death or personal injury
              caused by our negligence, or for fraud.
            </p>
          </section>

          <section className="mb-7">
            <h2 className="font-display mb-2 text-base font-semibold text-text">
              10. Changes to these terms
            </h2>
            <p className="text-sm leading-relaxed text-muted">
              We may update these terms from time to time, for example as
              StudyFlow&apos;s features change. We&apos;ll update the date at
              the top of this page when we do, and for significant changes
              we&apos;ll try to let you know directly.
            </p>
          </section>

          <section>
            <h2 className="font-display mb-2 text-base font-semibold text-text">
              11. Governing law and contact
            </h2>
            <p className="mb-3 text-sm leading-relaxed text-muted">
              These terms are governed by the laws of England and Wales.
            </p>
            <p className="text-sm leading-relaxed text-muted">
              Questions about these terms? Contact us at{" "}
              <Link href="mailto:hello@astrape.co.uk" className="text-il underline transition-colors hover:text-text">
                hello@astrape.co.uk
              </Link>
              .
            </p>
          </section>
        </article>
      </main>
    </>
  );
}
