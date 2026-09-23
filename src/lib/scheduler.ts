import { differenceInHours, isAfter, isBefore, parseISO } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import type {
  Task, Assignment, BlockedTime, ScheduledBlock, ScheduledBlockInsert, DayOfWeek,
} from "@/types";

const PREFERRED_START_HOUR = 8;
const PREFERRED_END_HOUR = 22;
const LATE_NIGHT_END_HOUR = 24;
const MAX_CONTINUOUS_HOURS = 2;
const MIN_BLOCK_MINUTES = 30;
const DEADLINE_BUFFER_HOURS = 2;
const MIN_GAP_MINUTES = 15;
const RELAXED_HOURS_PER_DAY = 1.5;
const URGENT_HOURS_PER_DAY = 8;
const MAX_STUDY_MINUTES_PER_DAY = 10 * 60;

const DAY_NAMES: DayOfWeek[] = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const pad2 = (n: number) => String(n).padStart(2, "0");

export const FATIGUE_WEIGHTS: Record<number, number> = {
  0: 0.3, 1: 0.3, 2: 0.3, 3: 0.3, 4: 0.3, 5: 0.35,   // ← was missing
  6: 0.9, 7: 0.9, 8: 0.95, 9: 1.0, 10: 1.0, 11: 1.0,
  12: 0.95, 13: 0.8, 14: 0.8, 15: 0.9, 16: 0.95, 17: 0.95,
  18: 0.9, 19: 0.85, 20: 0.85, 21: 0.7, 22: 0.6, 23: 0.5,
};

function getFatigueWeight(hour: number, personalWeights?: Record<number, number>): number {
  return (personalWeights ?? FATIGUE_WEIGHTS)[Math.floor(hour)] ?? 0.5;
}

// ── timezone-safe helpers ────────────────────────────────────────────────────
// Rule: after toZonedTime, wall time lives in the date's UTC fields.
// ALWAYS read them with getUTC* — getHours()/getDay() return the *server's* tz.

interface Interval { start: number; end: number } // minutes since midnight (wall)

function zonedParts(date: Date, timezone: string) {
  const z = toZonedTime(date, timezone);
  return {
    y: z.getUTCFullYear(),
    mo: z.getUTCMonth(),
    d: z.getUTCDate(),
    minutes: z.getUTCHours() * 60 + z.getUTCMinutes(),
    dayName: DAY_NAMES[z.getUTCDay()],
    dayKey: `${z.getUTCFullYear()}-${pad2(z.getUTCMonth() + 1)}-${pad2(z.getUTCDate())}`,
  };
}

function wallToUtc(y: number, mo: number, d: number, minutes: number, timezone: string): Date {
  return fromZonedTime(new Date(Date.UTC(y, mo, d, Math.floor(minutes / 60), minutes % 60)), timezone);
}

const dayNum = (y: number, mo: number, d: number) => Date.UTC(y, mo, d) / 86_400_000;

function subtractIntervals(base: Interval[], cuts: Interval[]): Interval[] {
  let result = base;
  for (const cut of cuts) {
    const next: Interval[] = [];
    for (const iv of result) {
      if (iv.end <= cut.start || iv.start >= cut.end) { next.push(iv); continue; }
      if (iv.start < cut.start) next.push({ start: iv.start, end: cut.start });
      if (cut.end < iv.end) next.push({ start: cut.end, end: iv.end });
    }
    result = next;
  }
  return result.filter((iv) => iv.end - iv.start >= MIN_BLOCK_MINUTES);
}

function bestWindowInIntervals(
  intervals: Interval[],
  sessionMinutes: number,
  peakPreferenceStrength: number,
  personalHourWeights: Record<number, number> | undefined,
  anchorStartMin: number,
  anchorEndMin: number
): Interval | null {
  const span = Math.max(1, anchorEndMin - anchorStartMin);
  let best: Interval | null = null;
  let bestScore = -Infinity;
  for (const iv of intervals) {
    for (let s = Math.ceil(iv.start / 30) * 30; s + sessionMinutes <= iv.end; s += 30) {
      const startHour = s / 60;
      const endHour = (s + sessionMinutes) / 60;
      let w = 0, n = 0;
      for (let h = Math.floor(startHour); h < Math.ceil(endHour); h++) {
        w += getFatigueWeight(h, personalHourWeights); n++;
      }
      const avg = n > 0 ? w / n : 0.5;
      // earliness anchored to 08:00 — NOT midnight (this is what sent urgent work to 00:00)
      const earliness = 1 - Math.min(1, Math.max(0, (s - anchorStartMin) / span));
      const score = peakPreferenceStrength * avg + (1 - peakPreferenceStrength) * earliness;
      if (score > bestScore + 1e-9) { bestScore = score; best = { start: s, end: s + sessionMinutes }; }
    }
  }
  return best;
}

export function blockOverlapsBlockedTimes(
  block: { start_time: string; end_time: string },
  blockedTimes: BlockedTime[],
  timezone: string
): boolean {
  const sp = zonedParts(new Date(block.start_time), timezone);
  const ep = zonedParts(new Date(block.end_time), timezone);
  const endMin = sp.dayKey === ep.dayKey ? ep.minutes : LATE_NIGHT_END_HOUR * 60;
  return blockedTimes.some((bt) =>
    bt.days.includes(sp.dayName) &&
    sp.minutes < bt.end_hour * 60 && endMin > bt.start_hour * 60
  );
}

// ── main scheduler ───────────────────────────────────────────────────────────

interface DayState {
  key: string;
  y: number; mo: number; d: number;
  num: number;
  blocked: Interval[];
  occupied: Interval[];      // existing blocks + everything placed this run
  capacityMinutes: number;   // free minutes in the standard window
  loadMinutes: number;       // study minutes placed today
}

export function scheduleTasks(userId: string, input: ScheduleInput): ScheduleOutput {
  const now = input.now ?? new Date();
  const tz = input.timezone;
  const nowWall = zonedParts(now, tz);

  // Build the day map across the whole horizon
  const active = input.tasks.filter((t) => t.status !== "done");
  const maxDeadline = active.reduce(
    (max, t) => { const dl = parseISO(t.assignment.deadline); return dl > max ? dl : max; },
    now
  );
  const horizon = zonedParts(new Date(maxDeadline.getTime() - DEADLINE_BUFFER_HOURS * 3_600_000), tz);
  const endNum = dayNum(horizon.y, horizon.mo, horizon.d);

  const days: DayState[] = [];
  const cursor = new Date(Date.UTC(nowWall.y, nowWall.mo, nowWall.d));
  while (dayNum(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()) <= endNum) {
    const y = cursor.getUTCFullYear(), mo = cursor.getUTCMonth(), d = cursor.getUTCDate();
    const dayName = DAY_NAMES[cursor.getUTCDay()];
    days.push({
      key: `${y}-${pad2(mo + 1)}-${pad2(d)}`,
      y, mo, d,
      num: dayNum(y, mo, d),
      blocked: input.blockedTimes
        .filter((bt) => bt.days.includes(dayName))
        .map((bt) => ({ start: Math.round(bt.start_hour * 60), end: Math.round(bt.end_hour * 60) })),
      occupied: [],
      capacityMinutes: 0,
      loadMinutes: 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const dayByKey = new Map(days.map((d) => [d.key, d]));

  // Seed existing blocks (skip ones already over; handle midnight spillover)
  for (const b of input.existingBlocks) {
    if (!isAfter(new Date(b.end_time), now)) continue;
    const sp = zonedParts(new Date(b.start_time), tz);
    const ep = zonedParts(new Date(b.end_time), tz);
    const startDay = dayByKey.get(sp.dayKey);
    if (!startDay) continue;
    if (sp.dayKey === ep.dayKey) {
      startDay.occupied.push({ start: sp.minutes, end: ep.minutes });
    } else {
      startDay.occupied.push({ start: sp.minutes, end: LATE_NIGHT_END_HOUR * 60 });
      dayByKey.get(ep.dayKey)?.occupied.push({ start: 0, end: ep.minutes });
    }
  }

  for (const day of days) {
    day.capacityMinutes = subtractIntervals(
      [{ start: PREFERRED_START_HOUR * 60, end: PREFERRED_END_HOUR * 60 }],
      [...day.blocked, ...day.occupied]
    ).reduce((s, iv) => s + (iv.end - iv.start), 0);
  }

  // Earliest deadline first, priority as tiebreak
  const sorted = [...active].sort((a, b) => {
    const da = parseISO(a.assignment.deadline).getTime();
    const db = parseISO(b.assignment.deadline).getTime();
    if (da !== db) return da - db;
    return priorityScore(b, b.assignment, now) - priorityScore(a, a.assignment, now);
  });

  const remaining = new Map<string, number>();
  const originalHours = new Map<string, number>();
  for (const task of sorted) {
    let hours = applyPaceRatio(task.estimated_hours, input.paceRatio);
    if (task.status === "in_progress" && task.started_at) {
      hours = Math.max(0, hours - (now.getTime() - new Date(task.started_at).getTime()) / 3_600_000);
    }
    originalHours.set(task.id, hours);
    remaining.set(task.id, Math.max(0, hours - (input.alreadyScheduledHours?.[task.id] ?? 0)));
  }

  const assignDayMinutes = new Map<string, Map<string, number>>();
  const scheduledSoFar: ScheduledBlockInsert[] = [];
  const panicTaskIds = new Set<string>();
  const finished = new Set<string>();
  const atRisk: ScheduleOutput["atRisk"] = [];

  const finalize = (task: Task & { assignment: Assignment }) => {
    if (finished.has(task.id)) return;
    finished.add(task.id);
    const R = remaining.get(task.id) ?? 0;
    if (R <= 0.25) return;
    const untilWall = zonedParts(
      new Date(parseISO(task.assignment.deadline).getTime() - DEADLINE_BUFFER_HOURS * 3_600_000), tz);
    // REAL availability: actual free minutes left before the deadline
    const freeHours = days
      .filter((d) => d.num <= dayNum(untilWall.y, untilWall.mo, untilWall.d))
      .reduce((s, d) => s + Math.max(0, d.capacityMinutes - d.loadMinutes), 0) / 60;
    atRisk.push({
      task,
      assignment: task.assignment,
      hoursNeeded: originalHours.get(task.id) ?? 0,
      hoursAvailable: Math.round(freeHours * 10) / 10,
    });
  };

  let progress = true;
  let guard = 0;
  while (progress && guard++ < 300) {
    progress = false;

    for (const task of sorted) {
      if (finished.has(task.id)) continue;
      const R = remaining.get(task.id) ?? 0;
      if (R <= 0.25) { finished.add(task.id); continue; }

      const assignment = task.assignment;
      const deadline = parseISO(assignment.deadline);
      const untilWall = zonedParts(
        new Date(deadline.getTime() - DEADLINE_BUFFER_HOURS * 3_600_000), tz);
      const usable = days.filter((d) => d.num <= dayNum(untilWall.y, untilWall.mo, untilWall.d));
      if (usable.length === 0) { finalize(task); continue; }

      const idealPerDay = R / usable.length;
      const ratio = Math.min(1, Math.max(0,
        (idealPerDay - RELAXED_HOURS_PER_DAY) / (URGENT_HOURS_PER_DAY - RELAXED_HOURS_PER_DAY)));
      const panic = isPanicTask(task, assignment, now, differenceInHours(deadline, now)) || ratio >= 0.99;
      if (panic) panicTaskIds.add(task.id);

      // Session length: enough to finish within the days left, capped at 2h.
      // Relaxed -> round (spreads thin), urgent -> ceil (packs enough per day).
      const halves = idealPerDay * 2;
      const rounded = (ratio >= 0.5 ? Math.ceil(halves) : Math.round(halves)) / 2;
      const sessionMinutes = Math.round(Math.min(MAX_CONTINUOUS_HOURS, Math.max(0.5, rounded)) * 60);

      const assignDays = assignDayMinutes.get(assignment.id) ?? new Map<string, number>();
      assignDayMinutes.set(assignment.id, assignDays);

      const gap = panic ? 0 : MIN_GAP_MINUTES;
      const tiers: Array<{ freshOnly: boolean; lateNight: boolean }> = [
        { freshOnly: true, lateNight: false },   // spread: one fresh day per session
        { freshOnly: false, lateNight: false },  // double up when days run out
      ];
      if (panic) tiers.push({ freshOnly: false, lateNight: true }); // last resort only

      let placedDay: DayState | null = null;
      let placed: Interval | null = null;

      for (const tier of tiers) {
        const candidates = usable
          .filter((d) => d.capacityMinutes >= MIN_BLOCK_MINUTES)
          .filter((d) => d.loadMinutes + sessionMinutes <= MAX_STUDY_MINUTES_PER_DAY)
          .filter((d) => (tier.freshOnly ? !assignDays.has(d.key) : true))
          .sort((a, b) => a.loadMinutes - b.loadMinutes || a.num - b.num); // least-loaded first

        for (const day of candidates) {
          const earliest = day.key === nowWall.dayKey
            ? Math.ceil(nowWall.minutes / 30) * 30
            : PREFERRED_START_HOUR * 60;
          let latest = tier.lateNight ? LATE_NIGHT_END_HOUR * 60 : PREFERRED_END_HOUR * 60;
          if (day.num === dayNum(untilWall.y, untilWall.mo, untilWall.d)) {
            latest = Math.min(latest, untilWall.minutes); // respect deadline buffer
          }

          const free = subtractIntervals(
            [{ start: earliest, end: latest }],
            [...day.blocked, ...day.occupied.map((o) => ({ start: o.start - gap, end: o.end + gap }))]
          );
          const win = bestWindowInIntervals(
            free, sessionMinutes, 1 - ratio, input.personalHourWeights,
            PREFERRED_START_HOUR * 60, latest
          );
          if (win) { placedDay = day; placed = win; break; }
        }
        if (placed) break;
      }

      if (!placedDay || !placed) { finalize(task); continue; }

      const minutes = placed.end - placed.start;
      scheduledSoFar.push({
        user_id: userId,
        task_id: task.id,
        start_time: wallToUtc(placedDay.y, placedDay.mo, placedDay.d, placed.start, tz).toISOString(),
        end_time: wallToUtc(placedDay.y, placedDay.mo, placedDay.d, placed.end, tz).toISOString(),
      });
      placedDay.occupied.push(placed);
      placedDay.loadMinutes += minutes;
      assignDays.set(placedDay.key, (assignDays.get(placedDay.key) ?? 0) + minutes / 60);
      remaining.set(task.id, R - minutes / 60);
      progress = true;
    }
  }

  for (const task of sorted) finalize(task);

  return { blocks: scheduledSoFar, panicTaskIds: [...panicTaskIds], atRisk };
}
