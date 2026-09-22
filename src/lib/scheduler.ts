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

const PREFERRED_START_HOUR = 8;
const PREFERRED_END_HOUR = 22;
const LATE_NIGHT_END_HOUR = 24;
const LATE_NIGHT_START_HOUR = 0;
const MAX_CONTINUOUS_HOURS = 2;
const MIN_BLOCK_MINUTES = 30;
const DEADLINE_BUFFER_HOURS = 2;
const MIN_GAP_MINUTES = 15;
const GLOBAL_RELAXED_HOURS_PER_DAY = 4;
const PANIC_HOURS_THRESHOLD = 48;
const PANIC_HARD_THRESHOLD = 24;
const RELAXED_HOURS_PER_DAY = 1.5;
const URGENT_HOURS_PER_DAY = 8;

export const FATIGUE_WEIGHTS: Record<number, number> = {
  6: 0.9, 7: 0.9, 8: 0.95, 9: 1.0, 10: 1.0, 11: 1.0,
  12: 0.95, 13: 0.8, 14: 0.8, 15: 0.9, 16: 0.95, 17: 0.95,
  18: 0.9, 19: 0.85, 20: 0.85, 21: 0.7, 22: 0.6, 23: 0.5,
};

function getFatigueWeight(hour: number, personalWeights?: Record<number, number>): number {
  const table = personalWeights ?? FATIGUE_WEIGHTS;
  return table[Math.floor(hour)] ?? 0.5;
}

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
    urgencyRatio: ratio,
    peakPreferenceStrength: 1 - ratio,
    allowLateNight: ratio >= 0.5,
  };
}

function dateToDayName(date: Date): DayOfWeek {
  const names: DayOfWeek[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return names[date.getDay()];
}

function dateToHour(date: Date): number {
  return date.getHours() + date.getMinutes() / 60;
}

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

function overlapsExistingBlock(
  slotStart: Date,
  slotEnd: Date,
  existingBlocks: ScheduledBlock[],
  scheduledSoFar: ScheduledBlockInsert[],
  gapMinutes = 0
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

  return allBlocks.some((b) => {
    const paddedStart = addMinutes(b.start, -gapMinutes);
    const paddedEnd = addMinutes(b.end, gapMinutes);
    return isBefore(slotStart, paddedEnd) && isAfter(slotEnd, paddedStart);
  });
}

function getOpenSlotsByDay(params: {
  from: Date;
  until: Date;
  timezone: string;
  personalHourWeights?: Record<number, number>;
  blockedTimes: BlockedTime[];
  existingBlocks: ScheduledBlock[];
  scheduledSoFar: ScheduledBlockInsert[];
  allowLateNight: boolean;
  gapMinutes?: number;
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
    gapMinutes = 0,
  } = params;

  const byDay = new Map<string, TimeSlot[]>();
  const endHour = allowLateNight ? LATE_NIGHT_END_HOUR : PREFERRED_END_HOUR;

  const zonedFrom = toZonedTime(from, timezone);
  const zonedUntil = toZonedTime(until, timezone);

  let currentZonedDay = startOfDay(zonedFrom);
  const endZonedDay = startOfDay(zonedUntil);

  while (!isAfter(currentZonedDay, endZonedDay)) {
    const dayKey = format(currentZonedDay, "yyyy-MM-dd");
    const roundedUpToHalfHour = Math.ceil(dateToHour(zonedFrom) * 2) / 2;
    const startHour =
      currentZonedDay.getTime() === startOfDay(zonedFrom).getTime()
        ? Math.max(PREFERRED_START_HOUR, roundedUpToHalfHour)
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

      const slotStart = fromZonedTime(zonedSlotStart, timezone);
      const slotEnd = addMinutes(slotStart, MIN_BLOCK_MINUTES);

      if (isAfter(slotStart, until)) break;
      if (slotStart < from) {
        hour += 0.5;
        continue;
      }

      if (
        !isInBlockedTime(currentZonedDay, hour, blockedTimes) &&
        !overlapsExistingBlock(slotStart, slotEnd, existingBlocks, scheduledSoFar, gapMinutes)
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

interface PlacedWindow {
  start: Date;
  end: Date;
  hours: number;
  dayKey: string;
}

function bestWindowInDay(
  daySlots: TimeSlot[],
  turnHours: number,
  peakPreferenceStrength: number,
  dayWindowStartHour: number,
  dayWindowEndHour: number
): PlacedWindow | null {
  if (daySlots.length === 0) return null;

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
        const earlinessScore = 1 - normalizedOffset;
    return peakPreferenceStrength * avgWeight + (1 - peakPreferenceStrength) * earlinessScore;
  }

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
      dayKey: format(window[0].start, "yyyy-MM-dd"),
    };
  }

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
    dayKey: format(window[0].start, "yyyy-MM-dd"),
  };
}

function placeTurn(params: {
  from: Date;
  until: Date;
  timezone: string;
  turnHours: number;
  peakPreferenceStrength: number;
  allowLateNight: boolean;
  respectGap: boolean;
  personalHourWeights?: Record<number, number>;
  blockedTimes: BlockedTime[];
  existingBlocks: ScheduledBlock[];
  scheduledSoFar: ScheduledBlockInsert[];
  assignmentDayTotals: Map<string, number>;
  dailyAssignmentTarget: number;
  globalDayTotals: Map<string, number>;
  globalDailyTarget: number;
}): PlacedWindow | null {
  const {
    from,
    until,
    timezone,
    turnHours,
    peakPreferenceStrength,
    allowLateNight,
    respectGap,
    personalHourWeights,
    blockedTimes,
    existingBlocks,
    scheduledSoFar,
    assignmentDayTotals,
    dailyAssignmentTarget,
    globalDayTotals,
    globalDailyTarget,
  } = params;

  const dayWindowStartHour = allowLateNight ? LATE_NIGHT_START_HOUR : PREFERRED_START_HOUR;
  const dayWindowEndHour = allowLateNight ? LATE_NIGHT_END_HOUR : PREFERRED_END_HOUR;

  const gapTiers = respectGap ? [MIN_GAP_MINUTES, 0] : [0];
  
  const slotsByGap = new Map<number, Map<string, TimeSlot[]>>();
  function slotsFor(gapMinutes: number) {
    let cached = slotsByGap.get(gapMinutes);
    if (!cached) {
      cached = getOpenSlotsByDay({
        from,
        until,
        timezone,
        personalHourWeights,
        blockedTimes,
        existingBlocks,
        scheduledSoFar,
        allowLateNight,
        gapMinutes,
      });
      slotsByGap.set(gapMinutes, cached);
    }
    return cached;
  }

  for (const gapMinutes of gapTiers) {
    const slotsByDay = slotsFor(gapMinutes);
    if (slotsByDay.size === 0) continue;

    const orderedDayKeys = [...slotsByDay.keys()].sort();

    for (const dayPreference of ["both", "assignmentOnly", "none"] as const) {
      for (const dayKey of orderedDayKeys) {
        if (dayPreference !== "none") {
          const usedByAssignment = assignmentDayTotals.get(dayKey) ?? 0;
          if (usedByAssignment >= dailyAssignmentTarget) continue;
        }
        if (dayPreference === "both") {
          const usedGlobally = globalDayTotals.get(dayKey) ?? 0;
          if (usedGlobally >= globalDailyTarget) continue;
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
  }

  return null;
}

export function applyPaceRatio(estimatedHours: number, paceRatio: number): number {
  const adjusted = estimatedHours * paceRatio;
  const clamped = Math.max(
    estimatedHours * 0.4,
    Math.min(estimatedHours * 2.5, adjusted)
  );
  return Math.round(clamped * 4) / 4;
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
  const scheduledSoFar: ScheduledBlockInsert[] = [];
  const assignmentDayTotals = new Map<string, Map<string, number>>();
  const globalDayTotals = new Map<string, number>();
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
      const isPanic = isPanicTask(task, assignment, now, totalAvailableHours);
      if (isPanic) {
        panicTaskIds.add(task.id);
      }

      const assignmentRemainingHours = sortedTasks
        .filter((t) => t.assignment.id === assignment.id && !finished.has(t.id))
        .reduce((sum, t) => sum + (remainingHours.get(t.id) ?? 0), 0);

      const urgency = computeUrgency(assignmentRemainingHours, hoursUntilDeadline);
      const dailyAssignmentTarget = Math.max(RELAXED_HOURS_PER_DAY, urgency.neededHoursPerDay);
      const globalDailyTarget = Math.max(GLOBAL_RELAXED_HOURS_PER_DAY, dailyAssignmentTarget);

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
        respectGap: !isPanic,
        personalHourWeights: input.personalHourWeights,
        blockedTimes: input.blockedTimes,
        existingBlocks: input.existingBlocks,
        scheduledSoFar,
        assignmentDayTotals: dayTotals,
        dailyAssignmentTarget,
        globalDayTotals,
        globalDailyTarget,
      });

      if (!placed) {
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
      globalDayTotals.set(placed.dayKey, (globalDayTotals.get(placed.dayKey) ?? 0) + placed.hours);
      remainingHours.set(task.id, remaining - placed.hours);
      progressMadeThisPass = true;
    }
  }

  for (const task of sortedTasks) {
    if (!finished.has(task.id)) finalizeAtRisk(task);
  }

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
