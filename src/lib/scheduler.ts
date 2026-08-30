// src/lib/scheduler.ts
import {
  addDays,
  addMinutes,
  differenceInDays,
  differenceInHours,
  isAfter,
  isBefore,
  startOfDay,
  setHours,
  setMinutes,
  format,
  parseISO,
} from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import type {
  Task,
  Assignment,
  BlockedTime,
  ScheduledBlock,
  ScheduledBlockInsert,
  TimeSlot,
  DayOfWeek,
} from "@/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const PREFERRED_START_HOUR = 8;
const PREFERRED_END_HOUR = 22;
const LATE_NIGHT_END_HOUR = 24;
// Mirrors LATE_NIGHT_END_HOUR at the other end of the day: when urgency is
// high enough to open up late-night hours, it should also open up early
// morning on later days, not just extend how late the *current* day runs.
// Without this, a genuinely urgent multi-day crunch could study until
// midnight but then sit idle from 12am-8am the next day even though it's
// exactly the kind of last-minute situation that should use every open
// hour -- university deadlines very often land first thing in the morning,
// so those hours matter.
const LATE_NIGHT_START_HOUR = 0;
// Ceiling on a single sitting, and therefore the size of one round-robin
// turn (see scheduleTasks). Deliberately *not* a daily total cap anymore --
// see the note above RELAXED_HOURS_PER_DAY below.
const MAX_CONTINUOUS_HOURS = 2;
const MIN_BLOCK_MINUTES = 30;
const DEADLINE_BUFFER_HOURS = 2;

// Panic mode thresholds
const PANIC_HOURS_THRESHOLD = 48;
const PANIC_HARD_THRESHOLD = 24;

// ── Per-assignment daily pace ────────────────────────────────────────────────
//
// There is deliberately no hard daily-hours ceiling anymore -- neither
// per-assignment nor combined across assignments. A genuinely large amount
// of work due tomorrow needs to be schedulable up to whatever the calendar
// actually has open (24h minus blocked time minus what's already
// scheduled), not artificially refused because it exceeds a fixed number.
// What replaces the old fixed bands (1.5h/day relaxed -> 8h/day "crunch")
// is a *soft* per-assignment daily target computed from genuine need:
//
//   targetHoursPerDay = max(RELAXED_HOURS_PER_DAY, hoursNeeded / daysLeft)
//
// -- i.e. "1.5h/day, or however much is actually required to finish in
// time, whichever is bigger". scheduleTasks() tries to keep each
// assignment's daily load under this target first, and only lets it spill
// over when the numbers genuinely don't fit otherwise (see placeTurn()).
// This is pace ("how much am I doing today"), not eligibility ("am I
// allowed to schedule more today") -- there's no longer a scenario where
// the scheduler refuses to place a turn purely because of a daily total.
const RELAXED_HOURS_PER_DAY = 1.5;
// Hours/day-equivalent need at which urgency saturates to 1 (fully
// ignoring peak-hour preference and always taking the earliest slot). This
// governs *preference/ordering* only -- see peakPreferenceStrength below --
// not how many hours can actually be scheduled, which has no ceiling.
const URGENT_HOURS_PER_DAY = 8;

// Default hour-of-day weight curve, used as the Bayesian prior in
// buildPersonalHourWeights() (src/lib/peak-hours.ts) and as the outright
// fallback for any user without enough history yet.
export const FATIGUE_WEIGHTS: Record<number, number> = {
  6: 0.9, 7: 0.9, 8: 0.95, 9: 1.0, 10: 1.0, 11: 1.0,
  12: 0.95, 13: 0.8, 14: 0.8, 15: 0.9, 16: 0.95, 17: 0.95,
  18: 0.9, 19: 0.85, 20: 0.85, 21: 0.7, 22: 0.6, 23: 0.5,
};

// `personalWeights`, when provided, is a *complete* 0-23 table (already
// blended with the static prior via buildPersonalHourWeights -- see
// src/lib/peak-hours.ts) and is used outright in place of the static
// table. There's no per-hour fallback needed here since that blending
// already guarantees every hour has a sensible value.
function getFatigueWeight(hour: number, personalWeights?: Record<number, number>): number {
  const table = personalWeights ?? FATIGUE_WEIGHTS;
  return table[Math.floor(hour)] ?? 0.5;
}

// ── Priority scoring ──────────────────────────────────────────────────────────

export function priorityScore(
  task: Task,
  assignment: Assignment,
  now: Date
): number {
  const base: Record<string, number> = {
    urgent: 40,
    high: 30,
    normal: 20,
    low: 10,
  };
  const daysLeft = differenceInDays(parseISO(assignment.deadline), now);
  const urgencyBonus = Math.max(0, 50 - daysLeft * 3);
  const overdueBonus = daysLeft < 0 ? 100 : 0;
  return (base[assignment.priority] ?? 20) + urgencyBonus + overdueBonus;
}

// ── Panic mode detection ──────────────────────────────────────────────────────

export function isPanicTask(
  task: Task,
  assignment: Assignment,
  now: Date,
  availableHours: number
): boolean {
  const hoursLeft = differenceInHours(parseISO(assignment.deadline), now);
  if (hoursLeft <= PANIC_HARD_THRESHOLD) return true;
  if (hoursLeft <= PANIC_HOURS_THRESHOLD && availableHours < task.estimated_hours) {
    return true;
  }
  return false;
}

// ── Urgency ───────────────────────────────────────────────────────────────────
//
// One number per assignment, per moment, driving three things at once:
// how strongly to prefer peak (high-weight) hours vs just grabbing the
// earliest slot, whether late-night hours are opened up, and (via
// targetHoursPerDay above) the soft daily pace target. "Urgency" here means
// "how many hours/day would this need if the remaining work were spread
// evenly from now to the deadline" -- not a fixed days-left cutoff, so it
// naturally accounts for how much work is actually left, not just how soon
// the deadline is (10 minutes of work due in an hour isn't urgent; 20 hours
// of work due in a day very much is).
function computeUrgency(hoursNeeded: number, hoursUntilDeadline: number) {
  const daysLeft = Math.max(hoursUntilDeadline, 1) / 24;
  const neededHoursPerDay = hoursNeeded / Math.max(daysLeft, 1 / 24);

  const ratio = Math.min(
    1,
    Math.max(
      0,
      (neededHoursPerDay - RELAXED_HOURS_PER_DAY) /
        (URGENT_HOURS_PER_DAY - RELAXED_HOURS_PER_DAY)
    )
  );

  return {
    neededHoursPerDay,
    // 0 = take it easy, 1 = fully urgent
    urgencyRatio: ratio,
    // 1 = strongly prefer peak/high-weight hours, 0 = ignore weight
    // entirely and just take the earliest slot available.
    peakPreferenceStrength: 1 - ratio,
    // Late-night hours open up once urgency crosses the midpoint.
    allowLateNight: ratio >= 0.5,
  };
}

// ── Day helpers ───────────────────────────────────────────────────────────────

function dateToDayName(date: Date): DayOfWeek {
  const names: DayOfWeek[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return names[date.getDay()];
}

function dateToHour(date: Date): number {
  return date.getHours() + date.getMinutes() / 60;
}

// ── Blocked time check ────────────────────────────────────────────────────────

function isInBlockedTime(
  date: Date,
  hour: number,
  blockedTimes: BlockedTime[]
): boolean {
  const dayName = dateToDayName(date);
  return blockedTimes.some((bt) => {
    if (!bt.days.includes(dayName)) return false;
    return hour >= bt.start_hour && hour < bt.end_hour;
  });
}

// ── Existing-block validity (used by /api/schedule/run for the "repair, not
// rebuild" reschedule path) ────────────────────────────────────────────────
//
// A previously-placed block can be invalidated by the user adding/editing a
// blocked time after the block was scheduled. This checks a single block
// (already-real UTC instants) against the current blocked-time list.
// Assumes the block doesn't span a day boundary in the given timezone --
// true by construction for anything scheduleTasks() itself produced, since
// getOpenSlotsByDay never builds a window that crosses a (zoned) calendar
// day.
export function blockOverlapsBlockedTimes(
  block: { start_time: string; end_time: string },
  blockedTimes: BlockedTime[],
  timezone: string
): boolean {
  const zonedStart = toZonedTime(new Date(block.start_time), timezone);
  const zonedEnd = toZonedTime(new Date(block.end_time), timezone);
  const dayName = dateToDayName(zonedStart);
  const startHour = dateToHour(zonedStart);
  const endHour = dateToHour(zonedEnd);

  return blockedTimes.some((bt) => {
    if (!bt.days.includes(dayName)) return false;
    return startHour < bt.end_hour && endHour > bt.start_hour;
  });
}

// ── Overlap check ────────────────────────────────────────────────────────────

function overlapsExistingBlock(
  slotStart: Date,
  slotEnd: Date,
  existingBlocks: ScheduledBlock[],
  scheduledSoFar: ScheduledBlockInsert[]
): boolean {
  const allBlocks = [
    ...existingBlocks.map((b) => ({
      start: new Date(b.start_time),
      end: new Date(b.end_time),
    })),
    ...scheduledSoFar.map((b) => ({
      start: new Date(b.start_time),
      end: new Date(b.end_time),
    })),
  ];

  return allBlocks.some(
    (b) => isBefore(slotStart, b.end) && isAfter(slotEnd, b.start)
  );
}

// ── Free slot generation ──────────────────────────────────────────────────────
//
// Returns every open half-hour slot between `from` and `until`, grouped by
// (timezone-local) calendar day, respecting blocked times and existing
// bookings only. Deliberately has no notion of a daily cap -- that's now a
// placement *preference* (see placeTurn below), not an eligibility filter
// on which slots even get generated.
//
// `from`/`until`/`existingBlocks` are real instants (UTC) throughout -- that
// domain never changes, so overlap checks and deadline comparisons stay
// correct no matter what timezone the user is in. `timezone` is only used
// to figure out which *wall-clock* day/hour a given instant falls on (for
// day keys, weekday-based blocked times, and the preferred-hours window)
// and to convert a chosen wall-clock slot back into a real instant.
function getOpenSlotsByDay(params: {
  from: Date;
  until: Date;
  timezone: string;
  personalHourWeights?: Record<number, number>;
  blockedTimes: BlockedTime[];
  existingBlocks: ScheduledBlock[];
  scheduledSoFar: ScheduledBlockInsert[];
  allowLateNight: boolean;
}): Map<string, TimeSlot[]> {
  const {
    from,
    until,
    timezone,
    personalHourWeights,
    blockedTimes,
    existingBlocks,
    scheduledSoFar,
    allowLateNight,
  } = params;

  const byDay = new Map<string, TimeSlot[]>();
  const endHour = allowLateNight ? LATE_NIGHT_END_HOUR : PREFERRED_END_HOUR;

  // toZonedTime returns a Date whose *local* getters (getHours, getDay,
  // etc.) read as the wall-clock time in `timezone`, regardless of what
  // timezone this process is actually running in. All the
  // startOfDay/setHours/format day-key arithmetic below is written against
  // those local getters, so operating on this "zoned" Date instead of the
  // raw instant makes it timezone-correct with no other changes needed.
  const zonedFrom = toZonedTime(from, timezone);
  const zonedUntil = toZonedTime(until, timezone);

  let currentZonedDay = startOfDay(zonedFrom);
  const endZonedDay = startOfDay(zonedUntil);

  while (!isAfter(currentZonedDay, endZonedDay)) {
    const dayKey = format(currentZonedDay, "yyyy-MM-dd");

    const startHour =
      currentZonedDay.getTime() === startOfDay(zonedFrom).getTime()
        ? Math.max(PREFERRED_START_HOUR, dateToHour(zonedFrom))
        : allowLateNight
          ? LATE_NIGHT_START_HOUR
          : PREFERRED_START_HOUR;

    let hour = startHour;
    const daySlots: TimeSlot[] = [];

    while (hour < endHour) {
      const zonedSlotStart = setMinutes(
        setHours(new Date(currentZonedDay), Math.floor(hour)),
        Math.round((hour % 1) * 60)
      );
      // Convert the chosen wall-clock moment back into a real instant --
      // this (and slotEnd, derived from it) is what actually gets compared
      // against other real instants and stored to the DB.
      const slotStart = fromZonedTime(zonedSlotStart, timezone);
      const slotEnd = addMinutes(slotStart, MIN_BLOCK_MINUTES);

      if (isAfter(slotStart, until)) break;
      if (slotStart < from) {
        hour += 0.5;
        continue;
      }

      if (
        !isInBlockedTime(currentZonedDay, hour, blockedTimes) &&
        !overlapsExistingBlock(slotStart, slotEnd, existingBlocks, scheduledSoFar)
      ) {
        daySlots.push({
          start: slotStart,
          end: slotEnd,
          weight: getFatigueWeight(hour, personalHourWeights),
        });
      }

      hour += 0.5;
    }

    if (daySlots.length > 0) byDay.set(dayKey, daySlots);
    currentZonedDay = addDays(currentZonedDay, 1);
  }

  return byDay;
}

// ── Turn placement ────────────────────────────────────────────────────────────

interface PlacedWindow {
  start: Date;
  end: Date;
  hours: number;
  dayKey: string;
}

// Finds the best contiguous window (of up to `turnHours` long) within a
// single day's slot list. "Best" blends peak-hour preference and earliness
// according to `peakPreferenceStrength`: at 1, it's purely "highest average
// weight, ties broken by earliest"; at 0, it's purely "earliest available,
// full stop" -- weight isn't even considered. In between, it's a smooth
// blend, so a task that's moderately but not desperately urgent gets a
// moderate pull toward better hours without fully ignoring them.
//
// Returns a full-length (turnHours) window if one exists; otherwise the
// single longest contiguous run available that day (a partial turn), so a
// day with e.g. 45 minutes open before a lecture still gets used rather
// than skipped outright. Returns null only if the day has no slots at all.
function bestWindowInDay(
  daySlots: TimeSlot[],
  turnHours: number,
  peakPreferenceStrength: number,
  dayWindowStartHour: number,
  dayWindowEndHour: number
): PlacedWindow | null {
  if (daySlots.length === 0) return null;

  // Group into maximal contiguous runs (adjacent half-hour slots with no
  // gap between them).
  const runs: TimeSlot[][] = [];
  let currentRun: TimeSlot[] = [daySlots[0]];
  for (let i = 1; i < daySlots.length; i++) {
    if (daySlots[i].start.getTime() === currentRun[currentRun.length - 1].end.getTime()) {
      currentRun.push(daySlots[i]);
    } else {
      runs.push(currentRun);
      currentRun = [daySlots[i]];
    }
  }
  runs.push(currentRun);

  const turnSlotCount = Math.ceil(turnHours / 0.5);
  const daySpanHours = Math.max(dayWindowEndHour - dayWindowStartHour, 1);

  function scoreWindow(window: TimeSlot[]): number {
    const avgWeight = window.reduce((sum, s) => sum + s.weight, 0) / window.length;
    const startHour = dateToHour(window[0].start);
    const normalizedOffset = Math.min(
      1,
      Math.max(0, (startHour - dayWindowStartHour) / daySpanHours)
    );
    const earlinessScore = 1 - normalizedOffset;
    return peakPreferenceStrength * avgWeight + (1 - peakPreferenceStrength) * earlinessScore;
  }

  // Prefer a full-length window if any run has enough slots to contain
  // turnHours of contiguous time. turnHours itself doesn't have to be a
  // multiple of the 30-minute slot grid (e.g. a 0.75h remainder) --
  // turnSlotCount (rounded up) is only used to find a long-enough run; the
  // returned window's actual end time is exactly turnHours after its
  // start, not rounded up to the next slot boundary.
  let best: { window: TimeSlot[]; score: number } | null = null;
  for (const run of runs) {
    if (run.length < turnSlotCount) continue;
    for (let start = 0; start + turnSlotCount <= run.length; start++) {
      const window = run.slice(start, start + turnSlotCount);
      const score = scoreWindow(window);
      if (!best || score > best.score) best = { window, score };
    }
  }

  if (best) {
    const window = best.window;
    return {
      start: window[0].start,
      end: addMinutes(window[0].start, turnHours * 60),
      hours: turnHours,
      dayKey: format(window[0].start, "yyyy-MM-dd"), // overwritten by caller with the tz-correct key
    };
  }

  // No run long enough for a full turn -- fall back to the single longest
  // run available (a partial turn, using everything that run has -- there
  // isn't more to give), preferring higher score among same-length runs.
  let bestPartial: { window: TimeSlot[]; score: number } | null = null;
  for (const run of runs) {
    const score = scoreWindow(run);
    if (
      !bestPartial ||
      run.length > bestPartial.window.length ||
      (run.length === bestPartial.window.length && score > bestPartial.score)
    ) {
      bestPartial = { window: run, score };
    }
  }

  if (!bestPartial) return null;

  const window = bestPartial.window;
  return {
    start: window[0].start,
    end: window[window.length - 1].end,
    hours: window.length * 0.5,
    dayKey: format(window[0].start, "yyyy-MM-dd"), // overwritten by caller with the tz-correct key
  };
}

// Tries to place one round-robin turn for a task: up to `turnHours`, in the
// best available window before `until`. Two-tier by day: first pass only
// considers days where this assignment's own running total would stay
// under its soft daily target; if nothing fits anywhere under that
// preference, a second pass considers every remaining day regardless of
// the target. This is what makes the target "soft" -- a real, functioning
// preference the vast majority of the time, but never a hard wall that
// blocks scheduling work that genuinely needs to happen.
function placeTurn(params: {
  from: Date;
  until: Date;
  timezone: string;
  turnHours: number;
  peakPreferenceStrength: number;
  allowLateNight: boolean;
  personalHourWeights?: Record<number, number>;
  blockedTimes: BlockedTime[];
  existingBlocks: ScheduledBlock[];
  scheduledSoFar: ScheduledBlockInsert[];
  assignmentDayTotals: Map<string, number>;
  dailyAssignmentTarget: number;
}): PlacedWindow | null {
  const {
    from,
    until,
    timezone,
    turnHours,
    peakPreferenceStrength,
    allowLateNight,
    personalHourWeights,
    blockedTimes,
    existingBlocks,
    scheduledSoFar,
    assignmentDayTotals,
    dailyAssignmentTarget,
  } = params;

  const slotsByDay = getOpenSlotsByDay({
    from,
    until,
    timezone,
    personalHourWeights,
    blockedTimes,
    existingBlocks,
    scheduledSoFar,
    allowLateNight,
  });

  if (slotsByDay.size === 0) return null;

  const orderedDayKeys = [...slotsByDay.keys()].sort();
  const dayWindowStartHour = allowLateNight ? LATE_NIGHT_START_HOUR : PREFERRED_START_HOUR;
  const dayWindowEndHour = allowLateNight ? LATE_NIGHT_END_HOUR : PREFERRED_END_HOUR;

  for (const preferredOnly of [true, false]) {
    for (const dayKey of orderedDayKeys) {
      if (preferredOnly) {
        const usedToday = assignmentDayTotals.get(dayKey) ?? 0;
        if (usedToday >= dailyAssignmentTarget) continue;
      }

      const daySlots = slotsByDay.get(dayKey);
      if (!daySlots || daySlots.length === 0) continue;

      const window = bestWindowInDay(
        daySlots,
        turnHours,
        peakPreferenceStrength,
        dayWindowStartHour,
        dayWindowEndHour
      );
      if (window) {
        return { ...window, dayKey: format(toZonedTime(window.start, timezone), "yyyy-MM-dd") };
      }
    }
  }

  return null;
}

// ── Pace ratio ────────────────────────────────────────────────────────────────

export function applyPaceRatio(estimatedHours: number, paceRatio: number): number {
  const adjusted = estimatedHours * paceRatio;
  const clamped = Math.max(
    estimatedHours * 0.4,
    Math.min(estimatedHours * 2.5, adjusted)
  );
  return Math.round(clamped * 4) / 4;
}

// ── Main scheduling function ──────────────────────────────────────────────────

export interface ScheduleInput {
  tasks: Array<Task & { assignment: Assignment }>;
  blockedTimes: BlockedTime[];
  existingBlocks: ScheduledBlock[];
  paceRatio: number;
  // IANA zone (e.g. "Europe/London"), from profiles.timezone. Required --
  // there's no safe default here, since silently falling back to UTC would
  // reintroduce exactly the bug this parameter exists to fix for any
  // caller that forgets to pass it.
  timezone: string;
  // Optional per-user hour-of-day weight table (0-23), from
  // buildPersonalHourWeights() in src/lib/peak-hours.ts. Falls back to the
  // static FATIGUE_WEIGHTS curve when omitted -- e.g. a brand new user with
  // no scheduling history yet.
  personalHourWeights?: Record<number, number>;
  // Hours already covered by blocks the caller is keeping (not deleting)
  // for a given task, keyed by task id -- e.g. /api/schedule/run's "repair,
  // not rebuild" path, which only clears blocks that now conflict with a
  // blocked time and leaves everything else untouched. scheduleTasks()
  // subtracts this from what a task still needs rather than re-scheduling
  // the full amount from zero. Tasks not present in this map are treated
  // as having nothing already scheduled, same as before this existed.
  alreadyScheduledHours?: Record<string, number>;
  now?: Date;
}

export interface ScheduleOutput {
  blocks: ScheduledBlockInsert[];
  panicTaskIds: string[];
  atRisk: Array<{
    task: Task;
    assignment: Assignment;
    hoursNeeded: number;
    hoursAvailable: number;
  }>;
}

// Allocates in round-robin turns rather than scheduling one task to
// completion before moving to the next: every pass, each still-unfinished
// task gets one turn of up to MAX_CONTINUOUS_HOURS (or however much of it
// is actually left, if less -- turn size is driven by the task, not a
// fixed slot size), in priority order, then the next pass loops back
// around. This is what lets a large, high-priority assignment's tasks
// share days with smaller or less urgent ones instead of one assignment
// fully occupying the calendar before another gets a single hour.
export function scheduleTasks(userId: string, input: ScheduleInput): ScheduleOutput {
  const now = input.now ?? new Date();
  const scheduledSoFar: ScheduledBlockInsert[] = [];
  // Per-assignment, per-day running totals -- used only to decide
  // preference order in placeTurn (stay under the soft target if
  // possible), never to block placement outright.
  const assignmentDayTotals = new Map<string, Map<string, number>>();
  const atRisk: ScheduleOutput["atRisk"] = [];
  const panicTaskIds = new Set<string>();

  const sortedTasks = input.tasks
    .filter((t) => t.status !== "done")
    .sort(
      (a, b) =>
        priorityScore(b, b.assignment, now) - priorityScore(a, a.assignment, now)
    );

  const remainingHours = new Map<string, number>();
  const originalHoursToSchedule = new Map<string, number>();
  const finished = new Set<string>();

  for (const task of sortedTasks) {
    let hoursToSchedule = applyPaceRatio(task.estimated_hours, input.paceRatio);

    if (task.status === "in_progress" && task.started_at) {
      const spentHours = (now.getTime() - new Date(task.started_at).getTime()) / 3_600_000;
      hoursToSchedule = Math.max(0, hoursToSchedule - spentHours);
    }

    originalHoursToSchedule.set(task.id, hoursToSchedule);

    const alreadyScheduled = input.alreadyScheduledHours?.[task.id] ?? 0;
    remainingHours.set(task.id, Math.max(0, hoursToSchedule - alreadyScheduled));
  }

  const finalizeAtRisk = (task: Task & { assignment: Assignment }) => {
    if (finished.has(task.id)) return;
    finished.add(task.id);
    const needed = originalHoursToSchedule.get(task.id) ?? 0;
    const remaining = remainingHours.get(task.id) ?? 0;
    if (remaining > 0.25) {
      atRisk.push({
        task,
        assignment: task.assignment,
        hoursNeeded: needed,
        hoursAvailable: Math.max(0, needed - remaining),
      });
    }
  };

  let progressMadeThisPass = true;
  // Passes bounded generously but finitely -- 500 turns of up to 2h each
  // is 1000 hours of work, well past any real assignment, and the
  // per-task/per-pass "no room anywhere" check below already terminates
  // the normal case long before this. Purely a safety net against an
  // unforeseen logic bug spinning forever.
  let passGuard = 0;
  const MAX_PASSES = 500;

  while (progressMadeThisPass && finished.size < sortedTasks.length && passGuard < MAX_PASSES) {
    progressMadeThisPass = false;
    passGuard++;

    for (const task of sortedTasks) {
      if (finished.has(task.id)) continue;

      const remaining = remainingHours.get(task.id) ?? 0;
      if (remaining <= 0.25) {
        finished.add(task.id);
        continue;
      }

      const assignment = task.assignment;
      const deadline = parseISO(assignment.deadline);
      const until = new Date(deadline.getTime() - DEADLINE_BUFFER_HOURS * 3_600_000);

      if (isAfter(now, until)) {
        finalizeAtRisk(task);
        continue;
      }

      const hoursUntilDeadline = differenceInHours(deadline, now);
      const totalAvailableHours = Math.max(0, hoursUntilDeadline);
      if (isPanicTask(task, assignment, now, totalAvailableHours)) {
        panicTaskIds.add(task.id);
      }

      // Assignment-level remaining work (this task plus any not-yet-finished
      // sibling tasks) is what drives urgency -- a task that individually
      // looks relaxed can still belong to an assignment that's overall in
      // crunch if its siblings are behind too.
      const assignmentRemainingHours = sortedTasks
        .filter((t) => t.assignment.id === assignment.id && !finished.has(t.id))
        .reduce((sum, t) => sum + (remainingHours.get(t.id) ?? 0), 0);

      const urgency = computeUrgency(assignmentRemainingHours, hoursUntilDeadline);
      const dailyAssignmentTarget = Math.max(RELAXED_HOURS_PER_DAY, urgency.neededHoursPerDay);

      if (!assignmentDayTotals.has(assignment.id)) {
        assignmentDayTotals.set(assignment.id, new Map());
      }
      const dayTotals = assignmentDayTotals.get(assignment.id)!;

      const turnHours = Math.min(MAX_CONTINUOUS_HOURS, remaining);

      const placed = placeTurn({
        from: now,
        until,
        timezone: input.timezone,
        turnHours,
        peakPreferenceStrength: urgency.peakPreferenceStrength,
        allowLateNight: urgency.allowLateNight,
        personalHourWeights: input.personalHourWeights,
        blockedTimes: input.blockedTimes,
        existingBlocks: input.existingBlocks,
        scheduledSoFar,
        assignmentDayTotals: dayTotals,
        dailyAssignmentTarget,
      });

      if (!placed) {
        // No room anywhere before this task's deadline -- won't change on
        // a future pass (other tasks' turns only reduce availability
        // further), so resolve it now rather than retrying forever.
        finalizeAtRisk(task);
        continue;
      }

      const block: ScheduledBlockInsert = {
        user_id: userId,
        task_id: task.id,
        start_time: placed.start.toISOString(),
        end_time: placed.end.toISOString(),
      };
      scheduledSoFar.push(block);

      dayTotals.set(placed.dayKey, (dayTotals.get(placed.dayKey) ?? 0) + placed.hours);
      remainingHours.set(task.id, remaining - placed.hours);
      progressMadeThisPass = true;
    }
  }

  // Anything still unfinished when the loop exits (shouldn't normally
  // happen given the per-task finalizeAtRisk above, but covers the
  // passGuard safety net) gets resolved the same way.
  for (const task of sortedTasks) {
    if (!finished.has(task.id)) finalizeAtRisk(task);
  }

  return { blocks: scheduledSoFar, panicTaskIds: [...panicTaskIds], atRisk };
}

// ── Missed task detection ─────────────────────────────────────────────────────

export function detectMissedBlocks(
  blocks: ScheduledBlock[],
  now: Date = new Date()
): ScheduledBlock[] {
  return blocks.filter((b) => {
    const taskStatus = b.task?.status ?? "todo";
    return !b.is_missed && isBefore(new Date(b.end_time), now) && taskStatus === "todo";
  });
}

// ── Warning message builders ──────────────────────────────────────────────────

export function buildAtRiskMessage(
  taskName: string,
  assignmentName: string,
  deadline: string,
  hoursNeeded: number,
  hoursAvailable: number
): string {
  const deadlineFormatted = format(parseISO(deadline), "d MMM yyyy");
  const shortfall = (hoursNeeded - hoursAvailable).toFixed(1);
  return (
    `You're behind on "${taskName}" — there aren't enough free hours before your ` +
    `${assignmentName} deadline on ${deadlineFormatted}. ` +
    `You need ${hoursNeeded.toFixed(1)}h but only ${hoursAvailable.toFixed(1)}h are available ` +
    `(${shortfall}h short). Consider reducing your blocked times or starting now.`
  );
}

export function buildRescheduledMessage(taskName: string, newStartTime: string): string {
  const formatted = format(parseISO(newStartTime), "EEE d MMM 'at' HH:mm");
  return `"${taskName}" was missed but you're still on track — it's been rescheduled to ${formatted}.`;
}

export function buildOnTrackMessage(
  assignmentName: string,
  doneSections: number,
  totalSections: number,
  deadline: string
): string {
  const deadlineFormatted = format(parseISO(deadline), "d MMM");
  return (
    `You're on track for "${assignmentName}" — ${doneSections} of ${totalSections} sections done. ` +
    `Deadline: ${deadlineFormatted}. Keep it up.`
  );
}
