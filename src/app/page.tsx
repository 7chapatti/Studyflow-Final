import Link from "next/link";
import { CalendarIcon, CheckIcon, WandIcon, ZapIcon } from "@/components/icons";

const FEATURES = [
  {
    icon: WandIcon,
    title: "AI breaks down the brief",
    description:
      "Upload or describe an assignment and StudyFlow extracts the actual deliverables, word limits, and formatting rules for you.",
  },
  {
    icon: CalendarIcon,
    title: "Auto-scheduled around your life",
    description:
      "Tasks get placed into your week around the times you're already busy, with room to drag and adjust anything by hand.",
  },
  {
    icon: ZapIcon,
    title: "Adapts to your pace",
    description:
      "StudyFlow learns how long things actually take you and recalibrates future estimates instead of guessing every time.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-5 max-w-5xl mx-auto w-full">
        <span className="font-sora text-lg font-semibold text-text">StudyFlow</span>
        <nav className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-muted hover:text-text transition-colors">
            Log in
          </Link>
          <Link
            href="/signup"
            className="text-sm font-medium bg-indigo hover:bg-il text-white rounded-lg px-4 py-2 transition-colors"
          >
            Sign up free
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        <section className="max-w-3xl mx-auto px-6 pt-16 pb-20 text-center">
          <h1 className="font-sora text-4xl sm:text-5xl font-semibold text-text leading-tight mb-5">
            Your assignments, actually planned out.
          </h1>
          <p className="text-muted text-lg leading-relaxed mb-8 max-w-xl mx-auto">
            StudyFlow turns a brief into a realistic schedule — broken into tasks,
            fitted around your week, and adjusted as you go.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href="/signup"
              className="bg-indigo hover:bg-il text-white font-medium rounded-lg px-6 py-3 text-sm transition-colors"
            >
              Start free — no card required
            </Link>
            <Link
              href="/login"
              className="border border-border hover:border-indigo/50 text-text font-medium rounded-lg px-6 py-3 text-sm transition-colors"
            >
              Log in
            </Link>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-6 pb-24 grid gap-6 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <div key={title} className="bg-card border border-border rounded-2xl p-6">
              <div className="w-9 h-9 rounded-lg bg-indigo/10 text-il flex items-center justify-center mb-4">
                <Icon size={18} />
              </div>
              <h2 className="font-sora text-base font-semibold text-text mb-2">{title}</h2>
              <p className="text-muted text-sm leading-relaxed">{description}</p>
            </div>
          ))}
        </section>

        <section className="max-w-3xl mx-auto px-6 pb-24">
          <div className="bg-card border border-border rounded-2xl p-8 flex items-start gap-4">
            <div className="w-9 h-9 rounded-lg bg-green/10 text-green flex items-center justify-center shrink-0">
              <CheckIcon size={16} />
            </div>
            <p className="text-muted text-sm leading-relaxed">
              Free to start, with up to 2 active assignments and 3 AI analyses a
              month. Upgrade any time for more.
            </p>
          </div>
        </section>
      </main>

      <footer className="px-6 py-8 text-center text-dim text-xs">
        <Link href="/terms" className="hover:text-muted transition-colors">
          Terms
        </Link>
        {" · "}
        <Link href="/privacy" className="hover:text-muted transition-colors">
          Privacy
        </Link>
      </footer>
    </div>
  );
}
