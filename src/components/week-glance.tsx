import type { CSSProperties } from "react";
import { COLOUR_PALETTE, DUE_SOON_COLOUR } from "@/types";

type Tone = 0 | 1 | 2 | "due" | "blocked";

interface GlanceBlock {
  label: string;
  /** Distance from the top of the day, as a percentage of its height. */
  top: number;
  /** Block length, as a percentage of the day's height. */
  height: number;
  tone: Tone;
}

interface GlanceDay {
  name: string;
  blocks: readonly GlanceBlock[];
}

const WEEK: readonly GlanceDay[] = [
  {
    name: "Mon",
    blocks: [
      { label: "Lecture", top: 5, height: 12, tone: "blocked" },
      { label: "Essay", top: 30, height: 14, tone: 0 },
    ],
  },
  {
    name: "Tue",
    blocks: [
      { label: "Read", top: 10, height: 12, tone: 0 },
      { label: "Lab", top: 45, height: 14, tone: "blocked" },
    ],
  },
  {
    name: "Wed",
    blocks: [
      { label: "Work", top: 28, height: 30, tone: "blocked" },
      { label: "Read", top: 68, height: 10, tone: 1 },
    ],
  },
  {
    name: "Thu",
    blocks: [
      { label: "Code", top: 6, height: 12, tone: "due" },
      { label: "Code", top: 24, height: 14, tone: 2 },
      { label: "Lecture", top: 62, height: 10, tone: "blocked" },
    ],
  },
  {
    name: "Fri",
    blocks: [
      { label: "Lecture", top: 8, height: 12, tone: "blocked" },
      { label: "Essay", top: 30, height: 10, tone: 1 },
    ],
  },
  {
    name: "Sat",
    blocks: [
      { label: "Read", top: 6, height: 12, tone: 2 },
      { label: "Football", top: 50, height: 10, tone: "blocked" },
    ],
  },
  { name: "Sun", blocks: [] },
];

const LEGEND: readonly { label: string; tone: Tone }[] = [
  { label: "Assignment 1", tone: 0 },
  { label: "Assignment 2", tone: 1 },
  { label: "Assignment 3", tone: 2 },
  { label: "Due soon", tone: "due" },
  { label: "Blocked", tone: "blocked" },
];

function fillFor(tone: Exclude<Tone, "blocked">) {
  return tone === "due" ? DUE_SOON_COLOUR : COLOUR_PALETTE[tone];
}

export default function WeekGlance() {
  return (
    <figure className="chalk-grid m-0 flex flex-col gap-3 rounded-xl border border-border p-4">
      <figcaption className="sr-only">
        A sample week in StudyFlow: study blocks coloured by assignment, one
        block flagged as due soon, and busy time such as lectures and work
        shown as blocked.
      </figcaption>

      <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Colour key">
        {LEGEND.map(({ label, tone }) => (
          <li
            key={label}
            className={`flex items-center gap-1.5 text-xs text-muted before:size-2 before:rounded-sm ${
              tone === "blocked"
                ? "before:border before:border-blocked-edge before:bg-blocked"
                : "before:bg-(--swatch)"
            }`}
            style={
              tone === "blocked"
                ? undefined
                : ({ "--swatch": fillFor(tone).bg } as CSSProperties)
            }
          >
            {label}
          </li>
        ))}
      </ul>

      <ol className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {WEEK.map((day) => (
          <li key={day.name} className="flex min-w-0 flex-col gap-1.5">
            <h3 className="text-center text-xs font-normal text-muted">
              {day.name}
            </h3>
            <ol className="relative h-52 rounded border border-border bg-ink/60 sm:h-64">
              {day.blocks.length === 0 && (
                <li className="sr-only">Nothing planned</li>
              )}
              {day.blocks.map((block) => {
                const fill =
                  block.tone === "blocked" ? null : fillFor(block.tone);
                return (
                  <li
                    key={`${block.label}-${block.top}`}
                    className={`absolute inset-x-0.5 flex items-center justify-center overflow-hidden rounded-[3px] px-0.5 ${
                      fill ? "" : "border border-blocked-edge bg-blocked"
                    }`}
                    style={{
                      top: `${block.top}%`,
                      height: `${block.height}%`,
                      ...(fill
                        ? { background: fill.bg, color: fill.text }
                        : { color: "var(--color-text)" }),
                    }}
                  >
                    <p className="truncate text-[10px] leading-none sm:text-xs">
                      {block.label}
                    </p>
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
    </figure>
  );
}
