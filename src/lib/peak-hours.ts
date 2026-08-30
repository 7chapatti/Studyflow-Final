// src/lib/peak-hours.ts
//
// Turns a user's own scheduling history into a personalized version of the
// hour-of-day weight curve (src/lib/scheduler.ts's FATIGUE_WEIGHTS), so the
// "peak hours" the scheduler favors shift toward when a specific student
// actually gets things done, rather than one fixed curve for everyone.
//
// This module only computes the weight table -- it doesn't fetch data
// (that's the caller's job, see /api/schedule/run/route.ts) and, for now,
// the table it produces is informational (attached to each TimeSlot) rather
// than driving which slots the scheduler picks first. Actually using it to
// choose allocation order is part of the scheduler rework, not this file.

export interface HourObservation {
  // 0-23, in the user's own timezone -- callers are responsible for
  // converting from a stored UTC instant before calling this.
  hour: number;
  // Whether this scheduled block passed without being flagged missed.
  // Imperfect proxy for "the student was actually productive at this
  // hour" -- the data available (scheduled_blocks.is_missed) doesn't
  // capture actual productivity, only whether the plan held -- but it's a
  // reasonable, available signal: hours where blocks consistently get
  // missed are hours this student reliably isn't available or isn't
  // getting to the work, regardless of what a generic curve assumes.
  success: boolean;
}

// How many "pseudo-observations" of the static prior each hour bucket
// starts with. Higher = more real observations needed before a user's own
// history meaningfully outweighs the default curve for that hour. 6 means
// a single missed/completed block barely moves the needle, but a
// consistent pattern of ~10+ observations at a given hour dominates the
// prior -- deliberately conservative given how noisy a single data point
// is (a missed 6am block might just mean one rough morning, not that the
// student is never productive at 6am).
export const PRIOR_STRENGTH = 6;

// Bayesian shrinkage toward the static prior: with zero real observations
// for an hour, the result is exactly the prior; as real observations pile
// up, it shifts toward the empirical success ratio, at a rate governed by
// PRIOR_STRENGTH. This naturally handles cold start (new users, or hours
// they've simply never been scheduled at) without a hard "not enough data"
// cutoff -- there's no discontinuity where the curve suddenly snaps from
// "generic" to "personal".
export function buildPersonalHourWeights(
  observations: HourObservation[],
  staticWeights: Record<number, number>
): Record<number, number> {
  const buckets = new Map<number, { successes: number; total: number }>();

  for (const obs of observations) {
    const hour = Math.floor(obs.hour);
    if (hour < 0 || hour > 23) continue;
    const bucket = buckets.get(hour) ?? { successes: 0, total: 0 };
    bucket.total += 1;
    if (obs.success) bucket.successes += 1;
    buckets.set(hour, bucket);
  }

  const result: Record<number, number> = {};
  for (let hour = 0; hour < 24; hour++) {
    const prior = staticWeights[hour] ?? 0.5;
    const bucket = buckets.get(hour);
    if (!bucket || bucket.total === 0) {
      result[hour] = prior;
      continue;
    }
    result[hour] =
      (bucket.successes + prior * PRIOR_STRENGTH) / (bucket.total + PRIOR_STRENGTH);
  }

  return result;
}
