// src/lib/estimation.ts
//
// A deterministic, non-AI fallback/sanity-check for hour estimates. The AI
// analysis prompt is good at reading a brief and producing a sensible
// breakdown, but its total hour estimate for a given word count can drift
// between requests since it's ultimately a language model guessing a
// number, not doing arithmetic. This module extracts hard numeric signals
// (an explicit word count, or a question/problem count) from the brief
// text with plain regexes, then maps them to an hour estimate with a fixed
// calibration curve -- same inputs always produce the same output.
//
// This is intentionally a *sanity check*, not a replacement for the AI's
// section-by-section breakdown: it can't tell you what the sections are,
// only roughly how many hours the whole thing should add up to. See
// applyRuleBasedCorrection() in the analyse route for how the two combine.

export interface RuleEstimate {
  hours: number;
  basis: "word_count" | "question_count";
  // Human-readable explanation of what was detected, for logging/debugging
  // and optionally surfacing in the UI later.
  detail: string;
}

// Anchor points for word count -> hours, derived from the same calibration
// bands used in the AI prompt (1500w: 2.5-4h, 2000w: 3-5h, 3000w: 5-7h --
// each anchor here is that band's midpoint). Values are interpolated
// linearly between anchors, and extrapolated using the nearest segment's
// slope outside this range.
const WORD_COUNT_ANCHORS: Array<[words: number, hours: number]> = [
  [250, 1],
  [500, 1.5],
  [1000, 2],
  [1500, 3.25],
  [2000, 4],
  [3000, 6],
  [5000, 9],
  [8000, 14],
  [10000, 17],
];

const MIN_HOURS = 0.5;
const MAX_HOURS = 40;

function interpolateWordCountHours(words: number): number {
  const anchors = WORD_COUNT_ANCHORS;

  if (words <= anchors[0][0]) {
    // Extrapolate below the first anchor using the first segment's slope.
    const [w0, h0] = anchors[0];
    const [w1, h1] = anchors[1];
    const slope = (h1 - h0) / (w1 - w0);
    return Math.max(MIN_HOURS, h0 + (words - w0) * slope);
  }

  for (let i = 0; i < anchors.length - 1; i++) {
    const [w0, h0] = anchors[i];
    const [w1, h1] = anchors[i + 1];
    if (words >= w0 && words <= w1) {
      const t = (words - w0) / (w1 - w0);
      return h0 + t * (h1 - h0);
    }
  }

  // Above the last anchor: extrapolate using the last segment's slope.
  const [wLast, hLast] = anchors[anchors.length - 1];
  const [wPrev, hPrev] = anchors[anchors.length - 2];
  const slope = (hLast - hPrev) / (wLast - wPrev);
  return Math.min(MAX_HOURS, hLast + (words - wLast) * slope);
}

// ~0.9h per question/problem, matching the "5 question maths set: 3-6h"
// calibration band in the AI prompt (midpoint 4.5h / 5 = 0.9h).
const HOURS_PER_QUESTION = 0.9;

function parseCount(raw: string): number {
  return parseInt(raw.replace(/,/g, ""), 10);
}

// Tries a list of word-count patterns in order and returns the first match.
// Ranges ("1500-2000 words") are averaged.
function extractWordCount(text: string): number | null {
  const rangeMatch = text.match(
    /(\d[\d,]{2,6})\s*(?:-|to|–)\s*(\d[\d,]{2,6})\s*words?\b/i
  );
  if (rangeMatch) {
    const lo = parseCount(rangeMatch[1]);
    const hi = parseCount(rangeMatch[2]);
    if (lo > 0 && hi > lo) return Math.round((lo + hi) / 2);
  }

  const wordFirstPatterns = [
    /(\d[\d,]{2,6})\s*-?\s*words?\b/i,
    /(\d[\d,]{2,6})\s*-?\s*word\s+(?:essay|report|assignment|document|piece)/i,
  ];
  for (const pattern of wordFirstPatterns) {
    const m = text.match(pattern);
    if (m) {
      const n = parseCount(m[1]);
      if (n >= 100 && n <= 50000) return n;
    }
  }

  // "word limit: 2000" / "word count of 2000"
  const labelFirstMatch = text.match(
    /words?\s*(?:limit|count)?\s*(?:is|of|:)\s*(\d[\d,]{2,6})/i
  );
  if (labelFirstMatch) {
    const n = parseCount(labelFirstMatch[1]);
    if (n >= 100 && n <= 50000) return n;
  }

  return null;
}

// "5 questions", "10 problems", "6 exercises" -- deliberately narrow (no
// attempt to distinguish "question 3" from "3 questions") since this is a
// best-effort signal, not a parser; a false miss just means no rule-based
// estimate is produced and the AI's number stands unchallenged, which is
// the safe failure mode.
function extractQuestionCount(text: string): number | null {
  const m = text.match(/(\d{1,3})\s*(?:question|problem|exercise)s?\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n < 1 || n > 200) return null;
  return n;
}

// Returns null when no reliable numeric signal is found in the text --
// callers should treat that as "no opinion" and leave the AI's estimate
// alone, not as "zero hours".
export function estimateHoursFromText(text: string): RuleEstimate | null {
  const words = extractWordCount(text);
  if (words !== null) {
    const hours = Math.round(interpolateWordCountHours(words) * 4) / 4;
    return { hours, basis: "word_count", detail: `${words} words detected` };
  }

  const questions = extractQuestionCount(text);
  if (questions !== null) {
    const hours = Math.round(Math.max(MIN_HOURS, questions * HOURS_PER_QUESTION) * 4) / 4;
    return { hours, basis: "question_count", detail: `${questions} questions/problems detected` };
  }

  return null;
}
