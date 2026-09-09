import { describe, it, expect } from "vitest";
import { calculatePaceRatio, isValidCompletion } from "./pace";
import type { PaceLog } from "@/types";

function log(estimated: number, actual: number, loggedAt: string): PaceLog {
  return {
    id: crypto.randomUUID(),
    user_id: "user-1",
    task_id: "task-1",
    estimated_hours: estimated,
    actual_hours: actual,
    logged_at: loggedAt,
  };
}

describe("calculatePaceRatio", () => {
  it("returns 1.0 (neutral) with fewer than 5 samples", () => {
    const logs = [log(2, 4, "2026-01-01"), log(2, 4, "2026-01-02")];
    expect(calculatePaceRatio(logs)).toBe(1.0);
  });

  it("gives the same result regardless of input order -- ascending, descending, or shuffled", () => {
    const base: [number, number, string][] = [
      [2, 2, "2026-01-01"],
      [2, 2, "2026-01-02"],
      [2, 2, "2026-01-03"],
      [2, 2, "2026-01-04"],
      [2, 6, "2026-01-05"], // an outlier that must count the same regardless of position
    ];

    const ascending = base.map(([e, a, d]) => log(e, a, d));
    const descending = [...ascending].reverse();
    const shuffled = [ascending[2], ascending[0], ascending[4], ascending[1], ascending[3]];

    const ratioAscending = calculatePaceRatio(ascending);
    const ratioDescending = calculatePaceRatio(descending);
    const ratioShuffled = calculatePaceRatio(shuffled);

    expect(ratioDescending).toBe(ratioAscending);
    expect(ratioShuffled).toBe(ratioAscending);
  });

  it("only considers the most recent MAX_SAMPLES (20) entries, regardless of array order", () => {
    // 25 old fast logs (ratio 0.5) + 5 recent slow logs (ratio 2.0), fed in
    // ASCENDING order (oldest first) -- the exact order the old
    // slice(-MAX_SAMPLES) implementation would have handled correctly by
    // coincidence, included so the old and new implementations are both
    // checked against the same expectation.
    const oldFast = Array.from({ length: 25 }, (_, i) =>
      log(2, 1, `2025-01-${String(i + 1).padStart(2, "0")}`)
    );
    const recentSlow = Array.from({ length: 5 }, (_, i) =>
      log(2, 4, `2026-02-${String(i + 1).padStart(2, "0")}`)
    );

    const ratio = calculatePaceRatio([...oldFast, ...recentSlow]);

    // Only the 20 most recent should count. Of those 20, 15 are old-fast
    // (ratio contribution 1) and 5 are recent-slow (ratio contribution 4):
    // total actual = 15*1 + 5*4 = 35, total estimated = 20*2 = 40, ratio = 0.875
    expect(ratio).toBeCloseTo(0.875, 5);
  });

  it("clamps the ratio to the 0.4-2.5 range", () => {
    const veryFast = Array.from({ length: 5 }, (_, i) => log(10, 0.1, `2026-01-0${i + 1}`));
    const verySlow = Array.from({ length: 5 }, (_, i) => log(1, 100, `2026-01-0${i + 1}`));

    expect(calculatePaceRatio(veryFast)).toBe(0.4);
    expect(calculatePaceRatio(verySlow)).toBe(2.5);
  });

  it("returns 1.0 if total estimated hours is zero (avoids a divide-by-zero)", () => {
    const logs = Array.from({ length: 5 }, (_, i) => log(0, 0, `2026-01-0${i + 1}`));
    expect(calculatePaceRatio(logs)).toBe(1.0);
  });
});

describe("isValidCompletion", () => {
  it("rejects completions under 6 minutes as likely accidental", () => {
    expect(isValidCompletion(2, 0.05)).toBe(false);
  });

  it("rejects completions over 24 hours as likely left open", () => {
    expect(isValidCompletion(2, 25)).toBe(false);
  });

  it("rejects completions wildly over the estimate as likely forgot-to-stop", () => {
    expect(isValidCompletion(1, 11)).toBe(false);
  });

  it("accepts a sensible completion time", () => {
    expect(isValidCompletion(2, 2.5)).toBe(true);
  });
});
