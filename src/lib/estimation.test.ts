import { describe, it, expect } from "vitest";
import { estimateHoursFromText } from "./estimation";

describe("estimateHoursFromText", () => {
  it("returns null when there's no numeric signal in the text", () => {
    expect(estimateHoursFromText("Write an essay about the French Revolution.")).toBeNull();
  });

  it("matches the calibration anchors from the AI prompt at their word counts", () => {
    expect(estimateHoursFromText("Write a 1500 word essay on climate policy")?.hours).toBe(3.25);
    expect(estimateHoursFromText("Write a 2000 word essay on climate policy")?.hours).toBe(4);
    expect(estimateHoursFromText("Write a 3000 word essay on climate policy")?.hours).toBe(6);
  });

  it("interpolates between anchors for word counts in between", () => {
    // Halfway between 2000w/4h and 3000w/6h -> 2500w should be ~5h.
    const result = estimateHoursFromText("A 2500 word report is required");
    expect(result?.hours).toBe(5);
  });

  it("extrapolates upward beyond the last anchor without runaway growth", () => {
    const result = estimateHoursFromText("This is a 10000 word dissertation chapter");
    expect(result?.hours).toBeGreaterThan(15);
    expect(result?.hours).toBeLessThanOrEqual(40); // hard ceiling
  });

  it("extrapolates downward for very short pieces without going negative", () => {
    const result = estimateHoursFromText("Write a 200 word summary");
    expect(result?.hours).toBeGreaterThanOrEqual(0.5); // hard floor
    expect(result?.hours).toBeLessThan(1.5);
  });

  it("averages a word count range", () => {
    // Average of 1500-2000 = 1750, which sits between the 1500/2000 anchors.
    const result = estimateHoursFromText("Essay should be 1500-2000 words");
    expect(result?.hours).toBeGreaterThan(3.25);
    expect(result?.hours).toBeLessThan(4);
  });

  it("recognises 'word limit of N' phrasing where the number comes after 'word'", () => {
    const result = estimateHoursFromText("The word limit is 2000 for this piece");
    expect(result?.basis).toBe("word_count");
    expect(result?.hours).toBe(4);
  });

  it("recognises 'N-word essay' phrasing", () => {
    const result = estimateHoursFromText("Submit a 2000-word essay by Friday");
    expect(result?.hours).toBe(4);
  });

  it("handles comma-formatted word counts", () => {
    const result = estimateHoursFromText("A 3,000 word report");
    expect(result?.hours).toBe(6);
  });

  it("falls back to question-count calibration when there's no word count", () => {
    const result = estimateHoursFromText("Complete all 5 questions in the problem set");
    expect(result?.basis).toBe("question_count");
    expect(result?.hours).toBe(4.5); // 5 * 0.9
  });

  it("prefers word count over question count when both are present", () => {
    const result = estimateHoursFromText("Write a 2000 word essay covering 3 questions from the brief");
    expect(result?.basis).toBe("word_count");
  });

  it("ignores nonsensical question counts outside a plausible range", () => {
    expect(estimateHoursFromText("This is problem number 999999 in the archive")).toBeNull();
  });

  it("ignores implausible word counts (too small or absurdly large) rather than guessing", () => {
    expect(estimateHoursFromText("I have 5 words to say about this")).toBeNull();
  });

  it("is deterministic — same input always produces the same output", () => {
    const text = "A 2500 word essay on ethics";
    const a = estimateHoursFromText(text);
    const b = estimateHoursFromText(text);
    expect(a).toEqual(b);
  });
});
