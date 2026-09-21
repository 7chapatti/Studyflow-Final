import Link from "next/link";
import WeekGlance from "@/components/week-glance";

const STEPS = [
  {
    title: "You hand over the brief",
    description:
      "Upload the assignment sheet as a PDF, or just describe it in your own words. StudyFlow reads out the actual deliverables, word counts and formatting rules so nothing gets missed on a skim-read.",
  },
  {
    title: "It becomes a real week",
    description:
      "Every task gets an actual slot on your calendar, placed around lectures, work shifts and whatever else you've already got on, not a checklist sitting with no date attached to it.",
  },
  {
    title: "It learns your pace",
    description:
      "Spent 70 minutes on a reading you expected to take 40? StudyFlow adjusts future estimates instead of making you feel like you're behind.",
  },
] as const;

const primaryButton =
  "rounded-lg bg-indigo px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-il";
const outlineButton =
  "rounded-lg border border-muted px-4 py-2 text-sm text-text transition-colors hover:border-il hover:text-il";

export default function LandingPage() {
  return (
    <>
      <header className="border-b-2 border-border">
        <nav
          aria-label="Site"
          className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4"
        >
          <Link href="/" className="font-display text-base font-semibold text-text">
            StudyFlow
          </Link>
          <Link href="/login" className={`ml-auto mr-3 ${outlineButton}`}>
            Log in
          </Link>
          <Link href="/signup" className={primaryButton}>
            Sign up
          </Link>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6">
        <section
          aria-labelledby="hero-heading"
          className="grid items-center gap-10 py-12 lg:grid-cols-[1fr_1.5fr] lg:gap-12 lg:py-20"
        >
          <header>
            <h1
              id="hero-heading"
              className="font-display text-4xl font-semibold leading-[1.1] text-balance text-text sm:text-5xl lg:text-4xl xl:text-5xl"
            >
              Messy assignments, easily planned.
            </h1>
            <p className="mt-4 max-w-md leading-relaxed text-muted">
              Upload an assignment brief and StudyFlow breaks it down, estimates
              the work, and finds time for it around the rest of your week.
            </p>
            <Link
              href="/signup"
              className={`mt-8 inline-block px-6 py-3 ${primaryButton}`}
            >
              Start free, no card needed
            </Link>
          </header>

          <WeekGlance />
        </section>

        <section aria-labelledby="how-heading" className="max-w-xl pb-12">
          <h2 id="how-heading" className="mb-1 text-sm font-medium text-muted">
            How it works
          </h2>
          <ol>
            {STEPS.map(({ title, description }) => (
              <li
                key={title}
                className="border-t border-border py-5 last:border-b"
              >
                <h3 className="font-display text-base font-semibold text-text">
                  {title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">
                  {description}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <aside aria-label="Pricing" className="max-w-xl pb-20">
          <p className="text-sm leading-relaxed text-muted">
            <strong className="font-medium text-text">Free to start.</strong> Up
            to 2 active assignments and 3 AI analyses a month. Upgrade any time
            for more.
          </p>
        </aside>
      </main>

      <footer className="border-t border-border">
        <nav
          aria-label="Legal"
          className="mx-auto flex w-full max-w-6xl gap-5 px-6 py-6 text-xs text-dim"
        >
          <Link href="/terms" className="transition-colors hover:text-muted">
            Terms
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-muted">
            Privacy
          </Link>
        </nav>
      </footer>
    </>
  );
}
