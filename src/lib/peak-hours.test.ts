import { describe, it, expect } from "vitest";
import { buildPersonalHourWeights, PRIOR_STRENGTH, type HourObservation } from "./peak-hours";

const STATIC: Record<number, number> = {
  6: 0.9, 7: 0.9, 8: 0.95, 9: 1.0, 10: 1.0, 11: 1.0,
  12: 0.95, 13: 0.8, 14: 0.8, 15: 0.9, 16: 0.95, 17: 0.95,
  18: 0.9, 19: 0.85, 20: 0.85, 21: 0.7, 22: 0.6, 23: 0.5,
};

describe("buildPersonalHourWeights", () => {
  it("returns exactly the static prior for every hour with zero observations", () => {
    const result = buildPersonalHourWeights([], STATIC);
    for (let h = 0; h < 24; h++) {
      expect(result[h]).toBe(STATIC[h] ?? 0.5);
    }
  });

  it("falls back to 0.5 for hours missing from the static table (e.g. the small hours) with no observations", () => {
    const result = buildPersonalHourWeights([], STATIC);
    expect(result[3]).toBe(0.5);
  });

  it("barely moves a single observation away from the prior (cold start protection)", () => {
    const observations: HourObservation[] = [{ hour: 9, success: false }];
    const result = buildPersonalHourWeights(observations, STATIC);
    // Prior at hour 9 is 1.0. One failed observation shouldn't crash the
    // weight down to near 0 -- it should still be close to the prior.
    expect(result[9]).toBeGreaterThan(0.8);
    expect(result[9]).toBeLessThan(1.0);
  });

  it("converges toward the empirical ratio as real observations accumulate", () => {
    // Hour 9's prior is 1.0 (a "great" hour by default), but suppose this
    // particular student consistently misses blocks scheduled then --
    // e.g. they have a 9am lecture. With enough consistent failures, the
    // personal weight should end up well below the prior.
    const observations: HourObservation[] = Array.from({ length: 30 }, () => ({
      hour: 9,
      success: false,
    }));
    const result = buildPersonalHourWeights(observations, STATIC);
    expect(result[9]).toBeLessThan(0.3);
  });

  it("converges toward a high weight when a normally-poor hour is consistently successful for this student", () => {
    // Hour 22's prior is 0.6 (fairly fatigued, by default). A genuine
    // night-owl student who consistently completes blocks there should end
    // up with a personal weight noticeably higher than the static prior.
    const observations: HourObservation[] = Array.from({ length: 30 }, () => ({
      hour: 22,
      success: true,
    }));
    const result = buildPersonalHourWeights(observations, STATIC);
    expect(result[22]).toBeGreaterThan(0.85);
  });

  it("only affects hours that actually have observations -- other hours stay at their prior", () => {
    const observations: HourObservation[] = Array.from({ length: 20 }, () => ({
      hour: 22,
      success: true,
    }));
    const result = buildPersonalHourWeights(observations, STATIC);
    expect(result[9]).toBe(STATIC[9]);
    expect(result[14]).toBe(STATIC[14]);
  });

  it("ignores out-of-range hour values rather than throwing or corrupting other buckets", () => {
    const observations: HourObservation[] = [
      { hour: -1, success: true },
      { hour: 24, success: true },
      { hour: 9, success: true },
    ];
    const result = buildPersonalHourWeights(observations, STATIC);
    expect(Object.keys(result)).toHaveLength(24);
    // The one valid observation still gets counted.
    expect(result[9]).toBeGreaterThanOrEqual(STATIC[9]);
  });

  it("floors fractional hours down to the containing bucket", () => {
    const observations: HourObservation[] = Array.from({ length: 20 }, () => ({
      hour: 9.75,
      success: false,
    }));
    const result = buildPersonalHourWeights(observations, STATIC);
    expect(result[9]).toBeLessThan(STATIC[9]);
  });

  it("always returns a value in [0, 1] regardless of input mix", () => {
    const observations: HourObservation[] = Array.from({ length: 50 }, (_, i) => ({
      hour: i % 24,
      success: i % 3 === 0,
    }));
    const result = buildPersonalHourWeights(observations, STATIC);
    for (let h = 0; h < 24; h++) {
      expect(result[h]).toBeGreaterThanOrEqual(0);
      expect(result[h]).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic — same observations always produce the same weights", () => {
    const observations: HourObservation[] = [
      { hour: 9, success: true },
      { hour: 9, success: false },
      { hour: 20, success: true },
    ];
    const a = buildPersonalHourWeights(observations, STATIC);
    const b = buildPersonalHourWeights(observations, STATIC);
    expect(a).toEqual(b);
  });

  it("PRIOR_STRENGTH observations of agreement with the prior leave the weight essentially unchanged", () => {
    // If observations exactly match what the prior already predicts (treat
    // success as "matches a >=0.9 prior"), the blended result should stay
    // very close to the prior regardless of sample size.
    const observations: HourObservation[] = Array.from({ length: PRIOR_STRENGTH * 3 }, () => ({
      hour: 9,
      success: true,
    }));
    const result = buildPersonalHourWeights(observations, STATIC);
    expect(result[9]).toBeCloseTo(1.0, 1);
  });
});
