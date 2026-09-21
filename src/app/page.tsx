import Link from "next/link";

const STAGES = [
  {
    title: "You hand over the brief",
    description:
      "Upload the assignment sheet as a PDF, or just describe it in your own words. StudyFlow reads out the actual deliverables, word counts, and formatting rules so nothing gets missed on a skim-read.",
  },
  {
    title: "It becomes a real week",
    description:
      "Every task gets an actual slot on your calendar, placed around lectures, work shifts, and whatever else you've already got on — not a checklist sitting with no date attached to it.",
  },
  {
    title: "It learns your pace",
    description:
      "Spent 70 minutes on a reading you expected to take 40? StudyFlow adjusts future estimates instead of making you feel like you're behind.",
  },
];

type Kind = "a1" | "a2" | "a3" | "due" | "blocked";

const KIND_STYLE: Record<Kind, { bg: string; text: string }> = {
  a1: { bg: "#3D74A6", text: "#EAF2F9" },
  a2: { bg: "#5F9B5B", text: "#EBF5EA" },
  a3: { bg: "#7A6BAE", text: "#F0EDF7" },
  due: { bg: "#C24A3A", text: "#FBEAE7" },
  blocked: { bg: "#3E4A43", text: "#F3F1E9" },
};

const LEGEND: { kind: Kind; label: string }[] = [
  { kind: "a1", label: "Assignment 1" },
  { kind: "a2", label: "Assignment 2" },
  { kind: "a3", label: "Assignment 3" },
  { kind: "due", label: "Due soon" },
  { kind: "blocked", label: "Blocked" },
];

const WEEK: { day: string; blocks: { kind: Kind; label: string; top: number; height: number }[] }[] = [
  {
    day: "Mon",
    blocks: [
      { kind: "blocked", label: "Lecture", top: 5, height: 12 },
      { kind: "a1", label: "Essay", top: 30, height: 14 },
    ],
  },
  {
    day: "Tue",
    blocks: [
      { kind: "a1", label: "Read", top: 10, height: 12 },
      { kind: "blocked", label: "Lab", top: 45, height: 14 },
    ],
  },
  {
    day: "Wed",
    blocks: [
      { kind: "blocked", label: "Work", top: 28, height: 30 },
      { kind: "a2", label: "Read", top: 68, height: 10 },
    ],
  },
  {
    day: "Thu",
    blocks: [
      { kind: "due", label: "Code", top: 6, height: 12 },
      { kind: "a3", label: "Code", top: 24, height: 14 },
      { kind: "blocked", label: "Lecture", top: 62, height: 10 },
    ],
  },
  {
    day: "Fri",
    blocks: [
      { kind: "blocked", label: "Lecture", top: 8, height: 12 },
      { kind: "a2", label: "Essay", top: 30, height: 10 },
    ],
  },
  {
    day: "Sat",
    blocks: [
      { kind: "a3", label: "Read", top: 6, height: 12 },
      { kind: "blocked", label: "Football", top: 50, height: 10 },
    ],
  },
  { day: "Sun", blocks: [] },
];

function WeekGlance() {
  return (
    <figure aria-hidden="true" className="grid-paper border border-border rounded-lg p-4 flex flex-col gap-2.5 h-full">
      <div className="flex items-center gap-3.5 flex-wrap">
        {LEGEND.map(({ kind, label }) => (
          <span key={kind} className="flex items-center gap-1.5 font-inter text-[9px] text-muted">
            <span
              className="w-1.5 h-1.5 rounded-sm inline-block"
              style={{
                backgroundColor: KIND_STYLE[kind].bg,
                border: kind === "blocked" ? "1px solid #55625A" : undefined,
              }}
            />
            {label}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5 flex-1">
        {WEEK.map(({ day, blocks }) => (
          <div key={day} className="flex flex-col items-center gap-1.5">
            <span className="font-inter text-[10px] text-muted">{day}</span>
            <div className="relative w-full flex-1 bg-navy/60 border border-border rounded">
              {blocks.map((b, i) => (
                <span
                  key={i}
                  className="absolute left-0.5 right-0.5 rounded-sm flex items-center justify-center font-inter"
                  style={{
                    top: `${b.top}%`,
                    height: `${b.height}%`,
                    backgroundColor: KIND_STYLE[b.kind].bg,
                    color: KIND_STYLE[b.kind].text,
                    fontSize: "7px",
                    border: b.kind === "blocked" ? "1px solid #55625A" : undefined,
                  }}
                >
                  {b.label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-5 max-w-5xl mx-auto w-full border-b-2 border-[#3A473F]">
        <span className="font-sora text-lg font-semibold text-text">StudyFlow</span>
        <nav className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm text-text border border-muted rounded-md px-3.5 py-1.5 hover:border-il hover:text-il transition-colors"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="text-sm font-medium bg-indigo hover:bg-il text-navy rounded-md px-4 py-2 transition-colors"
          >
            Sign up
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        <section className="max-w-5xl mx-auto px-6 pt-14 pb-20 grid lg:grid-cols-[0.8fr_1.35fr] gap-8 items-stretch">
          <div className="flex flex-col justify-center">
            <h1 className="font-sora text-4xl font-semibold text-text leading-[1.2] mb-4">
              Messy assignments,
              <br />
              easily planned.
            </h1>
            <p className="text-muted leading-relaxed max-w-sm">
              Upload an assignment brief and StudyFlow breaks it down, estimates the work, and finds
              time for it around the rest of your week.
            </p>
          </div>
          <WeekGlance />
        </section>

        <section className="max-w-4xl mx-auto px-6 pb-24">
          <div className="max-w-xl">
            <h2 className="font-sora text-sm font-medium text-dim mb-1">How it works</h2>
            <ul>
              {STAGES.map(({ title, description }, i) => (
                <li
                  key={title}
                  className={`border-t border-border py-4 ${i === STAGES.length - 1 ? "border-b" : ""}`}
                >
                  <h3 className="font-sora text-base font-semibold text-text mb-1.5">{title}</h3>
                  <p className="text-muted text-sm leading-relaxed">{description}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="max-w-4xl mx-auto px-6 pb-24">
          <aside className="border-t border-b border-border py-6">
            <p className="text-muted text-sm leading-relaxed max-w-xl">
              <strong className="text-text font-medium">Free to start</strong> — up to 2 active
              assignments and 3 AI analyses a month. Upgrade any time for more.
            </p>
          </aside>
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
