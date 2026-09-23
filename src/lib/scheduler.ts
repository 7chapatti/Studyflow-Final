import {
  differenceInDays,
  differenceInHours,
  isAfter,
  isBefore,
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
  DayOfWeek,
} from "@/types";

// NOTE: was 8 — your calendar grid starts at 09:00, so 08:00 blocks rendered
// above the grid and over the day labels. If you want 8am sessions instead,
// change this back AND make your UI grid start at 08:00.
const PREFERRED_START_HOUR = 9;
const PREFERRED_END_HOUR = 22;
const LATE_NIGHT_END_HOUR = 24;
const MAX_CONTINUOUS_HOURS = 2;
const MIN_BLOCK_MINUTES = 30;
const DEADLINE_BUFFER_HOURS = 2;
const MIN_GAP_MINUTES = 15;
const MAX_STUDY_MINUTES_PER_DAY = 10 * 60;
const RELAXED_HOURS_PER_DAY = 1.5;
const URGENT_HOURS_PER_DAY = 8;
const PANIC_HOURS_THRESHOLD = 48;
const PANIC_HARD_THRESHOLD = 24;

export const FATIGUE_WEIGHTS: Record<number, number> = {
  0: 0.3, 1: 0.3, 2: 0.3, 3: 0.3, 4: 0.3, 5: 0.35,
  6: 0.9, 7: 0.9, 8: 0.95, 9: 1.0, 10: 1.0, 11: 1.0,
  12: 0.95, 13: 0.8, 14: 0.8, 15: 0.9, 16: 0.95, 17: 0.95,
  18: 0.9, 19: 0.85, 20: 0.85, 21: 0.7, 22: 0.6, 23: 0.5,
};

function getFatigueWeight(hour: number, personalWeights?: Record<number, number>): number {
  return (personalWeights ?? FATIGUE_WEIGHTS)[Math.floor(hour)] ?? 0.5;
}

export function priorityScore(task: Task, assignment: Assignment, now: Date): number {
  const base: Record<string, number> = { urgent: 40, high: 30, normal: 20, low: 10 };
  const daysLeft = differenceInDays(parseISO(assignment.deadline), now);
  const urgencyBonus = Math.max(0, 50 - daysLeft * 3);
  const overdueBonus = daysLeft < 0 ? 100 : 0;
  return (base[assignment.priority] ?? 20) + urgencyBonus + overdueBonus;
}

export function isPanicTask(
  task: Task,
  assignment: Assignment,
  now: Date,
  availableHours: number
): boolean {
  void task;
  if (availableHours <= PANIC_HARD_THRESHOLD) return true;
  if (availableHours <= PANIC_HOURS_THRESHOLD && availableHours < task.estimated_hours) return true;
  return false;
}

export function applyPaceRatio(estimatedHours: number, paceRatio: number): number {
  const adjusted = estimatedHours * paceRatio;
  const clamped = Math.max(estimatedHours * 0.4, Math.min(estimatedHours * 2.5, adjusted));
  return Math.round(clamped * 4) / 4;
}

// ── timezone-safe helpers ────────────────────────────────────────────────────
// After toZonedTime, wall time lives in the date's UTC fields — always read
// them with getUTC*. getHours()/getDay() return the *server's* timezone.

interface Interval { start: number; end: number } // minutes since midnight, wall clock

const DAY_NAMES: DayOfWeek[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const dayNum = (y: number, mo: number, d: number) => Date.UTC(y, mo, d) / 86_400_000;

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
  return fromZonedTime(
    new Date(Date.UTC(y, mo, d, Math.floor(minutes / 60), minutes % 60)),
    timezone
  );
}

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
  return blockedTimes.some(
    (bt) =>
      bt.days.includes(sp.dayName) &&
      sp.minutes < bt.end_hour * 60 &&
      endMin > bt.start_hour * 60
  );
}

// ── main scheduler ───────────────────────────────────────────────────────────

interface DayState {
  key: string;
  y: number; mo: number; d: number;
  num: number;
  blocked: Interval[];
  occupied: Interval[];
  loadMinutes: number;
}

export interface ScheduleInput {
  tasks: Array<Task & { assignment: Assignment }>;
  blockedTimes: BlockedTime[];
  existingBlocks: ScheduledBlock[];
  paceRatio: number;
  timezone: string;
  personalHourWeights?: Record<number, number>;
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

export function scheduleTasks(userId: string, input: ScheduleInput): ScheduleOutput {
  const now = input.now ?? new Date();
  const tz = input.timezone;
  const nowWall = zonedParts(now, tz);

  const active = input.tasks.filter((t) => t.status !== "done");
  const maxDeadline = active.reduce(
    (m, t) => { const dl = parseISO(t.assignment.deadline); return dl > m ? dl : m; },
    now
  );
  const horizonWall = zonedParts(
    new Date(maxDeadline.getTime() - DEADLINE_BUFFER_HOURS * 3_600_000), tz
  );
  const endNum = dayNum(horizonWall.y, horizonWall.mo, horizonWall.d);

  // Build day states across the whole horizon
  const days: DayState[] = [];
  const cursor = new Date(Date.UTC(nowWall.y, nowWall.mo, nowWall.d));
  for (;;) {
    const y = cursor.getUTCFullYear(), mo = cursor.getUTCMonth(), d = cursor.getUTCDate();
    const num = dayNum(y, mo, d);
    if (num > endNum) break;
    const dayName = DAY_NAMES[cursor.getUTCDay()];
    days.push({
      key: `${y}-${pad2(mo + 1)}-${pad2(d)}`,
      y, mo, d, num,
      blocked: input.blockedTimes
        .filter((bt) => bt.days.includes(dayName))
        .map((bt) => ({ start: Math.round(bt.start_hour * 60), end: Math.round(bt.end_hour * 60) })),
      occupied: [],
      loadMinutes: 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const dayByKey = new Map(days.map((day) => [day.key, day]));

  // Seed existing blocks (skip finished ones; handle midnight spillover)
  for (const b of input.existingBlocks) {
    const endAt = new Date(b.end_time);
    if (!isAfter(endAt, now)) continue;
    const sp = zonedParts(new Date(b.start_time), tz);
    const ep = zonedParts(endAt, tz);
    const startDay = dayByKey.get(sp.dayKey);
    if (!startDay) continue;
    if (sp.dayKey === ep.dayKey) {
      startDay.occupied.push({ start: sp.minutes, end: ep.minutes });
    } else {
      startDay.occupied.push({ start: sp.minutes, end: LATE_NIGHT_END_HOUR * 60 });
      dayByKey.get(ep.dayKey)?.occupied.push({ start: 0, end: ep.minutes });
    }
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
      hours -= (now.getTime() - new Date(task.started_at).getTime()) / 3_600_000;
    }
    hours = Math.max(0, hours);
    originalHours.set(task.id, hours);
    const already = input.alreadyScheduledHours?.[task.id] ?? 0;
    remaining.set(task.id, Math.max(0, hours - already));
  }

  const assignDayMinutes = new Map<string, Map<string, number>>();
  const scheduledSoFar: ScheduledBlockInsert[] = [];
  const panicTaskIds = new Set<string>();
  const finished = new Set<string>();
  const atRisk: ScheduleOutput["atRisk"] = [];

  const finalize = (task: Task & { assignment: Assignment }) => {
    if (finished.has(task.id)) return;
    finished.add(task.id);
    const left = remaining.get(task.id) ?? 0;
    if (left <= 0.25) return;
    const untilWall = zonedParts(
      new Date(parseISO(task.assignment.deadline).getTime() - DEADLINE_BUFFER_HOURS * 3_600_000), tz
    );
    const cut = dayNum(untilWall.y, untilWall.mo, untilWall.d);
    // REAL availability: free minutes before the deadline
    const freeMinutes = days
      .filter((day) => day.num <= cut)
      .reduce((sum, day) => {
        const earliest = day.key === nowWall.dayKey
          ? Math.ceil(nowWall.minutes / 30) * 30
          : PREFERRED_START_HOUR * 60;
        const free = subtractIntervals(
          [{ start: earliest, end: PREFERRED_END_HOUR * 60 }],
          [...day.blocked, ...day.occupied]
        );
        return sum + free.reduce((s, iv) => s + (iv.end - iv.start), 0);
      }, 0);
    atRisk.push({
      task,
      assignment: task.assignment,
      hoursNeeded: originalHours.get(task.id) ?? 0,
      hoursAvailable: Math.round((freeMinutes / 60) * 10) / 10,
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
      const untilInstant = new Date(
        parseISO(assignment.deadline).getTime() - DEADLINE_BUFFER_HOURS * 3_600_000
      );
      if (isAfter(now, untilInstant)) { finalize(task); continue; }
      const untilWall = zonedParts(untilInstant, tz);
      const untilNum = dayNum(untilWall.y, untilWall.mo, untilWall.d);
      const usable = days.filter((day) => day.num <= untilNum);
      if (usable.length === 0) { finalize(task); continue; }

      const hoursUntilDeadline = differenceInHours(parseISO(assignment.deadline), now);
      const isPanic = isPanicTask(task, assignment, now, hoursUntilDeadline);

      // Urgency at the ASSIGNMENT level (all unfinished tasks of it)
      let assignmentRemaining = 0;
      for (const t of sorted) {
        if (t.assignment.id === assignment.id && !finished.has(t.id)) {
          assignmentRemaining += remaining.get(t.id) ?? 0;
        }
      }
      const idealPerDay = assignmentRemaining / usable.length;
      const ratio = Math.min(1, Math.max(0,
        (idealPerDay - RELAXED_HOURS_PER_DAY) / (URGENT_HOURS_PER_DAY - RELAXED_HOURS_PER_DAY)));
      if (isPanic || ratio >= 0.99) panicTaskIds.add(task.id);

      // Session length: full task or 2h cap, floored at 1h so small tasks
      // don't shatter into 30-min fragments when days are plentiful.
      const sessionHours = Math.min(R, MAX_CONTINUOUS_HOURS, Math.max(1, idealPerDay));
      const sessionMinutes = Math.max(15, Math.round(Math.min(sessionHours, R) * 4) * 15);

      let assignDays = assignDayMinutes.get(assignment.id);
      if (!assignDays) { assignDays = new Map(); assignDayMinutes.set(assignment.id, assignDays); }

      const gap = isPanic ? 0 : MIN_GAP_MINUTES;
      const tiers: Array<{ freshOnly: boolean; lateNight: boolean }> = [
        { freshOnly: true, lateNight: false },   // spread: one session/day per assignment
        { freshOnly: false, lateNight: false },  // double up when days run out
      ];
      if (isPanic || ratio >= 0.75) tiers.push({ freshOnly: false, lateNight: true });

      let placedDay: DayState | null = null;
      let placed: Interval | null = null;

      for (const tier of tiers) {
        for (const day of usable) {
          if (tier.freshOnly && assignDays.has(day.key)) continue;
          if (day.loadMinutes + sessionMinutes > MAX_STUDY_MINUTES_PER_DAY) continue;

          const earliest = day.key === nowWall.dayKey
            ? Math.ceil(nowWall.minutes / 30) * 30
            : PREFERRED_START_HOUR * 60;
          let latest = tier.lateNight ? LATE_NIGHT_END_HOUR * 60 : PREFERRED_END_HOUR * 60;
          if (day.num === untilNum) latest = Math.min(latest, untilWall.minutes);
          if (latest - earliest < sessionMinutes) continue;

          const cuts = [...day.blocked];
          for (const o of day.occupied) cuts.push({ start: o.start - gap, end: o.end + gap });
          const free = subtractIntervals([{ start: earliest, end: latest }], cuts);
          const win = bestWindowInIntervals(
            free, sessionMinutes, 1 - ratio, input.personalHourWeights,
            PREFERRED_START_HOUR * 60, latest
          );
          if (win) { placedDay = day; placed = win; break; }
        }
        if (placed) break;
      }

      if (!placedDay || !placed) { finalize(task); continue; }

      const placedMinutes = placed.end - placed.start;
      scheduledSoFar.push({
        user_id: userId,
        task_id: task.id,
        start_time: wallToUtc(placedDay.y, placedDay.mo, placedDay.d, placed.start, tz).toISOString(),
        end_time: wallToUtc(placedDay.y, placedDay.mo, placedDay.d, placed.end, tz).toISOString(),
      });
      placedDay.occupied.push(placed);
      placedDay.loadMinutes += placedMinutes;
      assignDays.set(placedDay.key, (assignDays.get(placedDay.key) ?? 0) + placedMinutes / 60);
      remaining.set(task.id, Math.max(0, R - placedMinutes / 60));
      progress = true;
    }
  }

  for (const task of sorted) finalize(task);

  return { blocks: scheduledSoFar, panicTaskIds: [...panicTaskIds], atRisk };
}

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
