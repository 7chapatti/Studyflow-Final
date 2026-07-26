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
const MAX_HOURS_PER_DAY = 10;
const MAX_CONTINUOUS_HOURS = 2;
const MIN_BLOCK_MINUTES = 30;
const DEADLINE_BUFFER_HOURS = 2;

// Panic mode thresholds
const PANIC_HOURS_THRESHOLD = 48;
const PANIC_HARD_THRESHOLD = 24;

const FATIGUE_WEIGHTS: Record<number, number> = {
  6: 0.9, 7: 0.9, 8: 0.95, 9: 1.0, 10: 1.0, 11: 1.0,
  12: 0.95, 13: 0.8, 14: 0.8, 15: 0.9, 16: 0.95, 17: 0.95,
  18: 0.9, 19: 0.85, 20: 0.85, 21: 0.7, 22: 0.6, 23: 0.5,
};

function getFatigueWeight(hour: number): number {
  return FATIGUE_WEIGHTS[Math.floor(hour)] ?? 0.5;
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

// ── Per-assignment daily cap ─────────────────────────────────────────────────

function getDailyHourCap(daysUntilDeadline: number): number {
  if (daysUntilDeadline <= 1) return 8;
  if (daysUntilDeadline <= 3) return 4;
  if (daysUntilDeadline <= 7) return 3;
  if (daysUntilDeadline <= 14) return 2;
  return 1.5;
}

// ── Free slot generation ──────────────────────────────────────────────────────

function getFreeSlots(params: {
  from: Date;
  until: Date;
  blockedTimes: BlockedTime[];
  existingBlocks: ScheduledBlock[];
  scheduledSoFar: ScheduledBlockInsert[];
  allowLateNight: boolean;
  dailyHoursUsed: Map<string, number>;
  dailyCapPerAssignment: Map<string, Map<string, number>>;
  assignmentId: string;
  dailyAssignmentCap: number;
}): TimeSlot[] {
  const {
    from,
    until,
    blockedTimes,
    existingBlocks,
    scheduledSoFar,
    allowLateNight,
    dailyHoursUsed,
    dailyCapPerAssignment,
    assignmentId,
    dailyAssignmentCap,
  } = params;

  const slots: TimeSlot[] = [];
  const endHour = allowLateNight ? LATE_NIGHT_END_HOUR : PREFERRED_END_HOUR;

  let currentDay = startOfDay(from);
  const endDay = startOfDay(until);

  while (!isAfter(currentDay, endDay)) {
    const dayKey = format(currentDay, "yyyy-MM-dd");
    const usedToday = dailyHoursUsed.get(dayKey) ?? 0;
    const remainingToday = MAX_HOURS_PER_DAY - usedToday;

    let asgnDayMap = dailyCapPerAssignment.get(assignmentId);
    if (!asgnDayMap) {
      asgnDayMap = new Map<string, number>();
      dailyCapPerAssignment.set(assignmentId, asgnDayMap);
    }
    const asgnUsedToday = asgnDayMap.get(dayKey) ?? 0;
    const asgnRemainingToday = dailyAssignmentCap - asgnUsedToday;

    if (remainingToday >= 0.5 && asgnRemainingToday >= 0.5) {
      const startHour =
        currentDay.getTime() === startOfDay(from).getTime()
          ? Math.max(PREFERRED_START_HOUR, dateToHour(from))
          : PREFERRED_START_HOUR;

      let hour = startHour;

      while (hour < endHour) {
        const slotStart = setMinutes(
          setHours(new Date(currentDay), Math.floor(hour)),
          Math.round((hour % 1) * 60)
        );
        const slotEnd = addMinutes(slotStart, MIN_BLOCK_MINUTES);

        if (isAfter(slotStart, until)) break;
        if (slotStart < from) {
          hour += 0.5;
          continue;
        }

        const todaySlots = slots.filter((s) => format(s.start, "yyyy-MM-dd") === dayKey).length;
        const projectedUsedToday = usedToday + todaySlots * 0.5;
        const projectedAsgnUsedToday = asgnUsedToday + todaySlots * 0.5;

        if (
          projectedUsedToday + 0.5 > MAX_HOURS_PER_DAY ||
          projectedAsgnUsedToday + 0.5 > dailyAssignmentCap
        ) {
          break;
        }

        if (
          !isInBlockedTime(currentDay, hour, blockedTimes) &&
          !overlapsExistingBlock(slotStart, slotEnd, existingBlocks, scheduledSoFar)
        ) {
          slots.push({
            start: slotStart,
            end: slotEnd,
            weight: getFatigueWeight(hour),
          });
        }

        hour += 0.5;
      }
    }

    currentDay = addDays(currentDay, 1);
  }

  return slots;
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
  const scheduledSoFar: ScheduledBlockInsert[] = [];
  const dailyHoursUsed = new Map<string, number>();
  const dailyCapPerAssignment = new Map<string, Map<string, number>>();
  const atRisk: ScheduleOutput["atRisk"] = [];
  const panicTaskIds: string[] = [];

  const sortedTasks = [...input.tasks].sort(
    (a, b) =>
      priorityScore(b, b.assignment, now) - priorityScore(a, a.assignment, now)
  );

  for (const task of sortedTasks) {
    if (task.status === "done") continue;

    const assignment = task.assignment;
    const deadline = parseISO(assignment.deadline);
    const daysUntilDeadline = differenceInDays(deadline, now);
    const hoursUntilDeadline = differenceInHours(deadline, now);
    const allowLateNight = daysUntilDeadline <= 2;

    const dailyAssignmentCap = getDailyHourCap(daysUntilDeadline);
    if (!dailyCapPerAssignment.has(assignment.id)) {
      dailyCapPerAssignment.set(assignment.id, new Map());
    }

    const totalAvailableHours = Math.max(0, hoursUntilDeadline);
    if (isPanicTask(task, assignment, now, totalAvailableHours)) {
      panicTaskIds.push(task.id);
    }

    const until = new Date(deadline.getTime() - DEADLINE_BUFFER_HOURS * 3_600_000);
    if (isAfter(now, until)) {
      atRisk.push({
        task,
        assignment,
        hoursNeeded: applyPaceRatio(task.estimated_hours, input.paceRatio),
        hoursAvailable: 0,
      });
      continue;
    }

    let hoursToSchedule = applyPaceRatio(task.estimated_hours, input.paceRatio);

    if (task.status === "in_progress" && task.started_at) {
      const spentHours =
        (now.getTime() - new Date(task.started_at).getTime()) / 3_600_000;
      hoursToSchedule = Math.max(0, hoursToSchedule - spentHours);
    }

    let remaining = hoursToSchedule;
    let continuousHours = 0;

    const slots = getFreeSlots({
      from: now,
      until,
      blockedTimes: input.blockedTimes,
      existingBlocks: input.existingBlocks,
      scheduledSoFar,
      allowLateNight,
      dailyHoursUsed,
      dailyCapPerAssignment,
      assignmentId: assignment.id,
      dailyAssignmentCap,
    });

    for (const slot of slots) {
      if (remaining <= 0) break;

      if (continuousHours >= MAX_CONTINUOUS_HOURS) {
        const lastBlock = scheduledSoFar.at(-1);
        if (lastBlock) {
          const gapHours =
            (slot.start.getTime() - new Date(lastBlock.end_time).getTime()) / 3_600_000;
          if (gapHours < 0.5) continue;
          continuousHours = 0;
        }
      }

      const dayKey = format(slot.start, "yyyy-MM-dd");
      const usedToday = dailyHoursUsed.get(dayKey) ?? 0;
      const asgnDayMap = dailyCapPerAssignment.get(assignment.id)!;
      const asgnUsedToday = asgnDayMap.get(dayKey) ?? 0;

      if (usedToday + 0.5 > MAX_HOURS_PER_DAY) continue;
      if (asgnUsedToday + 0.5 > dailyAssignmentCap) continue;

      const chunkHours = Math.min(remaining, 0.5);
      const chunkEnd = new Date(slot.start.getTime() + chunkHours * 3_600_000);

      const block: ScheduledBlockInsert = {
        user_id: userId,
        task_id: task.id,
        start_time: slot.start.toISOString(),
        end_time: chunkEnd.toISOString(),
      };

      scheduledSoFar.push(block);

      dailyHoursUsed.set(dayKey, usedToday + chunkHours);
      asgnDayMap.set(dayKey, asgnUsedToday + chunkHours);

      remaining -= chunkHours;
      continuousHours += chunkHours;
    }

    if (remaining > 0.25) {
      const hoursAvailable = Math.max(0, hoursToSchedule - remaining);
      atRisk.push({
        task,
        assignment,
        hoursNeeded: hoursToSchedule,
        hoursAvailable,
      });
    }
  }

  return { blocks: scheduledSoFar, panicTaskIds, atRisk };
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
