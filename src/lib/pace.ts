import type { PaceLog } from "@/types";

const MIN_SAMPLES = 5;    // minimum completions before adapting
const MAX_SAMPLES = 20;   // only use the most recent N samples
const MIN_RATIO = 0.4;    // never adjust below 40% of estimate
const MAX_RATIO = 2.5;    // never adjust above 250% of estimate

export interface PaceStatus {
  isActive: boolean;
  samplesCollected: number;
  samplesNeeded: number;
  ratio: number;
  label: string;
  description: string;
}

/**
 * Calculate the user's pace ratio from their completion history.
 * Returns 1.0 if not enough data, otherwise the clamped ratio.
 */
export function calculatePaceRatio(logs: PaceLog[]): number {
  if (logs.length < MIN_SAMPLES) return 1.0;

  const recent = logs.slice(-MAX_SAMPLES);
  const totalEstimated = recent.reduce((sum, l) => sum + l.estimated_hours, 0);
  const totalActual = recent.reduce((sum, l) => sum + l.actual_hours, 0);

  if (totalEstimated === 0) return 1.0;

  const ratio = totalActual / totalEstimated;
  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, ratio));
}

/**
 * Get a human-readable status of the user's pace profile.
 */
export function getPaceStatus(logs: PaceLog[]): PaceStatus {
  const ratio = calculatePaceRatio(logs);
  const isActive = logs.length >= MIN_SAMPLES;

  let label: string;
  let description: string;

  if (!isActive) {
    label = "Building your profile";
    description = `Complete ${MIN_SAMPLES - logs.length} more task${MIN_SAMPLES - logs.length === 1 ? "" : "s"} to activate pace tracking.`;
  } else if (ratio < 0.85) {
    label = "Faster than estimated";
    description = `You typically finish tasks ${Math.round((1 - ratio) * 100)}% faster than the AI estimates. Future estimates are adjusted down.`;
  } else if (ratio > 1.15) {
    label = "Takes a bit longer";
    description = `You typically take ${Math.round((ratio - 1) * 100)}% longer than the AI estimates. Future estimates are adjusted up.`;
  } else {
    label = "On track";
    description = "Your actual times match AI estimates closely. Estimates are applied as-is.";
  }

  return {
    isActive,
    samplesCollected: logs.length,
    samplesNeeded: MIN_SAMPLES,
    ratio: Math.round(ratio * 100) / 100,
    label,
    description,
  };
}

/**
 * Validate whether a completion time is sensible enough to log.
 * Filters out accidental starts (immediately marked done) and
 * sessions left open for days.
 */
export function isValidCompletion(
  estimatedHours: number,
  actualHours: number
): boolean {
  if (actualHours < 0.1) return false; // under 6 minutes — almost certainly accidental
  if (actualHours > 24) return false;  // more than a day — probably left open
  if (actualHours > estimatedHours * 10) return false; // wildly over — probably forgot to stop
  return true;
}
