import { describe, it, expect } from "vitest";
import { scheduleTasks, blockOverlapsBlockedTimes, type ScheduleInput } from "./scheduler";
import type { Task, Assignment, BlockedTime, ScheduledBlock } from "@/types";

// Fixed reference instant: Monday 2026-08-10T09:00:00Z.
const NOW = new Date("2026-08-10T09:00:00.000Z");
const TZ = "UTC"; // keeps the arithmetic in these tests easy to reason about by hand

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function makeAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: nextId("a"),
    user_id: "u1",
    name: "Assignment",
    description: null,
    deadline: "2026-08-25T00:00:00.000Z",
    priority: "normal",
    estimated_hours: 5,
    colour_index: 0,
    status: "active",
    archived_at: null,
    created_at: NOW.toISOString(),
    ...overrides,
  } as Assignment;
}

function makeTask(
  assignment: Assignment,
  overrides: Partial<Task> = {}
): Task & { assignment: Assignment } {
  return {
    id: nextId("t"),
    assignment_id: assignment.id,
    name: "Task",
    description: null,
    estimated_hours: 2,
    confidence_score: null,
    actual_hours: null,
    status: "todo",
    started_at: null,
    completed_at: null,
    order_index: 0,
    created_at: NOW.toISOString(),
    assignment,
    ...overrides,
  } as Task & { assignment: Assignment };
}

function baseInput(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    tasks: [],
    blockedTimes: [],
    existingBlocks: [],
    paceRatio: 1,
    now: NOW,
    timezone: TZ,
    ...overrides,
  };
}

function dayKeyUTC(iso: string): string {
  return iso.slice(0, 10);
}

describe("scheduleTasks — round-robin interleaving", () => {
  it("gives both assignments blocks on the same early day instead of fully scheduling one before the other starts", () => {
    // Two unrelated assignments, similar priority/deadline, each needing
    // several hours -- under the old greedy-per-task algorithm, assignment
    // A would fully occupy the calendar before B got a single block.
    const assignmentA = makeAssignment({ name: "Essay A", deadline: "2026-08-20T00:00:00.000Z" });
    const assignmentB = makeAssignment({ name: "Essay B", deadline: "2026-08-20T00:00:00.000Z" });

    const tasksA = [
      makeTask(assignmentA, { name: "A1", estimated_hours: 3 }),
      makeTask(assignmentA, { name: "A2", estimated_hours: 3 }),
    ];
    const tasksB = [makeTask(assignmentB, { name: "B1", estimated_hours: 3 })];

    const { blocks } = scheduleTasks("u1", baseInput({ tasks: [...tasksA, ...tasksB] }));

    const firstDay = dayKeyUTC(blocks[0].start_time);
    const firstDayAssignmentIds = new Set(
      blocks
        .filter((b) => dayKeyUTC(b.start_time) === firstDay)
        .map((b) => [...tasksA, ...tasksB].find((t) => t.id === b.task_id)?.assignment_id)
    );

    // Both assignments should appear on day one -- not just A.
    expect(firstDayAssignmentIds.has(assignmentA.id)).toBe(true);
    expect(firstDayAssignmentIds.has(assignmentB.id)).toBe(true);
  });

  it("splits a single assignment's tasks across different days rather than always adjacent", () => {
    const assignment = makeAssignment({ deadline: "2026-08-25T00:00:00.000Z" });
    const tasks = [
      makeTask(assignment, { name: "T1", estimated_hours: 2 }),
      makeTask(assignment, { name: "T2", estimated_hours: 2 }),
      makeTask(assignment, { name: "T3", estimated_hours: 2 }),
    ];
    // A second, competing assignment interleaved in priority so there's
    // actually something to split around.
    const other = makeAssignment({ deadline: "2026-08-22T00:00:00.000Z" });
    const otherTasks = [makeTask(other, { name: "O1", estimated_hours: 2 })];

    const { blocks } = scheduleTasks("u1", baseInput({ tasks: [...tasks, ...otherTasks] }));
    const dayKeys = new Set(blocks.map((b) => dayKeyUTC(b.start_time)));

    // With genuinely relaxed deadlines and a competing assignment in the
    // mix, the schedule should span more than a single day.
    expect(dayKeys.size).toBeGreaterThan(1);
  });
});

describe("scheduleTasks — turn size follows the task, not a fixed slot", () => {
  it("gives a small task exactly its remaining hours in one block, not padded to the 2h turn ceiling", () => {
    const assignment = makeAssignment();
    const task = makeTask(assignment, { estimated_hours: 0.75 });

    const { blocks } = scheduleTasks("u1", baseInput({ tasks: [task] }));

    expect(blocks).toHaveLength(1);
    const hours =
      (new Date(blocks[0].end_time).getTime() - new Date(blocks[0].start_time).getTime()) /
      3_600_000;
    expect(hours).toBeCloseTo(0.75, 2);
  });

  it("caps a single turn at 2h even for a much larger task, producing multiple blocks", () => {
    const assignment = makeAssignment();
    const task = makeTask(assignment, { estimated_hours: 5 });

    const { blocks } = scheduleTasks("u1", baseInput({ tasks: [task] }));
    const taskBlocks = blocks.filter((b) => b.task_id === task.id);

    expect(taskBlocks.length).toBeGreaterThan(1);
    for (const b of taskBlocks) {
      const hours = (new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / 3_600_000;
      expect(hours).toBeLessThanOrEqual(2);
    }
    const total = taskBlocks.reduce(
      (sum, b) => sum + (new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / 3_600_000,
      0
    );
    expect(total).toBeCloseTo(5, 1);
  });
});

describe("scheduleTasks — soft daily target, no hard ceiling", () => {
  it("schedules well beyond the old fixed 10h/day combined cap when genuinely needed", () => {
    // Two assignments both due tomorrow, each needing 8h -- 16h combined,
    // due the next day. The old hard MAX_HOURS_PER_DAY (10h) would have
    // made this impossible to front-load; there should be no such ceiling
    // now, only actual calendar availability (open hours minus blocked
    // time) as the limit.
    const dueSoon = "2026-08-11T20:00:00.000Z"; // ~35h after NOW
    const assignmentA = makeAssignment({ deadline: dueSoon, priority: "urgent" });
    const assignmentB = makeAssignment({ deadline: dueSoon, priority: "urgent" });
    const taskA = makeTask(assignmentA, { estimated_hours: 8 });
    const taskB = makeTask(assignmentB, { estimated_hours: 8 });

    const { blocks } = scheduleTasks("u1", baseInput({ tasks: [taskA, taskB] }));

    const hoursByDay = new Map<string, number>();
    for (const b of blocks) {
      const day = dayKeyUTC(b.start_time);
      const hours = (new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / 3_600_000;
      hoursByDay.set(day, (hoursByDay.get(day) ?? 0) + hours);
    }

    const maxDayHours = Math.max(...hoursByDay.values());
    expect(maxDayHours).toBeGreaterThan(10);
  });

  it("keeps a single relaxed assignment's daily load near the soft 1.5h/day target when there's no competing pressure", () => {
    const assignment = makeAssignment({ deadline: "2026-09-20T00:00:00.000Z" }); // ~41 days out
    const task = makeTask(assignment, { estimated_hours: 6 });

    const { blocks } = scheduleTasks("u1", baseInput({ tasks: [task] }));

    const hoursByDay = new Map<string, number>();
    for (const b of blocks) {
      const day = dayKeyUTC(b.start_time);
      const hours = (new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / 3_600_000;
      hoursByDay.set(day, (hoursByDay.get(day) ?? 0) + hours);
    }

    // Nothing forces this exactly to 1.5h/day (turns are capped at 2h), but
    // with 41 days of runway and no competing assignment, no single day
    // should be loaded anywhere near "crunch" levels.
    for (const hours of hoursByDay.values()) {
      expect(hours).toBeLessThanOrEqual(2);
    }
  });
});

describe("scheduleTasks — urgency-scaled peak-hour preference", () => {
  it("prefers the highest-weight hour of the day when the deadline is relaxed", () => {
    const assignment = makeAssignment({ deadline: "2026-09-20T00:00:00.000Z" }); // very relaxed
    const task = makeTask(assignment, { estimated_hours: 1 });

    // Make 14:00 UTC the unambiguous best hour of the day.
    const personalHourWeights: Record<number, number> = Object.fromEntries(
      Array.from({ length: 24 }, (_, h) => [h, h === 14 ? 1 : 0.3])
    );

    const { blocks } = scheduleTasks(
      "u1",
      baseInput({ tasks: [task], personalHourWeights })
    );

    expect(blocks).toHaveLength(1);
    const startHour = new Date(blocks[0].start_time).getUTCHours();
    expect(startHour).toBe(14);
  });

  it("ignores peak-hour weighting and takes the earliest slot when the assignment overall is under time pressure", () => {
    // Assignment overall needs a lot per day (11h of remaining work across
    // two tasks, due in 30h) -- squarely past the URGENT_HOURS_PER_DAY
    // threshold, so peakPreferenceStrength should be ~0 for every task in
    // this assignment, including the small one. task1 (1h) is listed first
    // so it gets the very first round-robin turn, before task2 (10h) can
    // consume the best-weighted hour.
    const deadline = new Date(NOW.getTime() + 30 * 3_600_000).toISOString();
    const assignment = makeAssignment({ deadline, priority: "urgent" });
    const task1 = makeTask(assignment, { name: "small", estimated_hours: 1 });
    const task2 = makeTask(assignment, { name: "big", estimated_hours: 10 });

    // 14:00 UTC (today) is still the "best" hour by weight, and it's well
    // within the deadline window (NOW+30h spans into the next afternoon),
    // so it's genuinely reachable -- urgency should override it anyway.
    const personalHourWeights: Record<number, number> = Object.fromEntries(
      Array.from({ length: 24 }, (_, h) => [h, h === 14 ? 1 : 0.3])
    );

    const { blocks } = scheduleTasks(
      "u1",
      baseInput({ tasks: [task1, task2], personalHourWeights })
    );

    const task1Block = blocks.find((b) => b.task_id === task1.id);
    expect(task1Block).toBeDefined();
    const startHour = new Date(task1Block!.start_time).getUTCHours();
    // NOW is 09:00 UTC -- the earliest available slot is 09:00, not 14:00.
    expect(startHour).toBe(9);
  });
});

describe("scheduleTasks — at-risk detection still works", () => {
  it("flags a task at risk when its deadline has already effectively passed", () => {
    const assignment = makeAssignment({
      deadline: new Date(NOW.getTime() + 1 * 3_600_000).toISOString(), // 1h from now, less than the 2h buffer
    });
    const task = makeTask(assignment, { estimated_hours: 3 });

    const { atRisk, blocks } = scheduleTasks("u1", baseInput({ tasks: [task] }));

    expect(blocks).toHaveLength(0);
    expect(atRisk).toHaveLength(1);
    expect(atRisk[0].task.id).toBe(task.id);
  });

  it("flags a task at risk when there genuinely isn't enough open time before the deadline, even with no daily ceiling", () => {
    // 3 hours from now, needing 20 hours of work -- impossible regardless
    // of how much per-day flexibility exists.
    const assignment = makeAssignment({
      deadline: new Date(NOW.getTime() + 3 * 3_600_000).toISOString(),
    });
    const task = makeTask(assignment, { estimated_hours: 20 });

    const { atRisk } = scheduleTasks("u1", baseInput({ tasks: [task] }));

    expect(atRisk.length).toBeGreaterThan(0);
    expect(atRisk[0].hoursNeeded).toBeGreaterThan(atRisk[0].hoursAvailable);
  });

  it("does not schedule into a blocked time even under high urgency", () => {
    const assignment = makeAssignment({
      deadline: new Date(NOW.getTime() + 20 * 3_600_000).toISOString(),
      priority: "urgent",
    });
    const task = makeTask(assignment, { estimated_hours: 1 });

    // Block every hour of the day except one specific window.
    const blockedTimes: BlockedTime[] = [
      {
        id: "bt1",
        user_id: "u1",
        label: "Everything except 9am",
        days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        start_hour: 9.5,
        end_hour: 24,
        repeat_weekly: true,
        created_at: NOW.toISOString(),
      } as BlockedTime,
    ];

    const { blocks } = scheduleTasks("u1", baseInput({ tasks: [task], blockedTimes }));

    for (const b of blocks) {
      const hour = new Date(b.start_time).getUTCHours();
      expect(hour).toBeLessThan(9.5 + 0.001);
    }
  });

  it("opens up early-morning hours (12am-8am) on a later day when urgency is high, not just late-night on today", () => {
    // A large amount of work due first thing tomorrow morning -- exactly
    // the "left it until the last minute, deadline is 9am" scenario. NOW
    // is 09:00 UTC; deadline is ~24h out, so `until` (deadline minus the 2h
    // buffer) lands at roughly 07:00 UTC the next day. For all of that
    // work to have any chance of fitting, hours before 8am on day two have
    // to be usable, not just late-night hours on day one.
    const deadline = new Date(NOW.getTime() + 24 * 3_600_000).toISOString();
    const assignment = makeAssignment({ deadline, priority: "urgent" });
    const task = makeTask(assignment, { estimated_hours: 18 });

    const { blocks } = scheduleTasks("u1", baseInput({ tasks: [task] }));

    const hasEarlyMorningBlockOnLaterDay = blocks.some((b) => {
      const start = new Date(b.start_time);
      const isLaterDay = start.getUTCDate() !== NOW.getUTCDate();
      const hour = start.getUTCHours();
      return isLaterDay && hour < 8;
    });

    expect(hasEarlyMorningBlockOnLaterDay).toBe(true);
  });

  it("still respects the normal 8am start on a later day when urgency is low", () => {
    // Plenty of runway (40+ days), so urgency should stay low and later
    // days should keep the normal 8am-10pm window -- no early-morning
    // creep for a relaxed assignment.
    const assignment = makeAssignment({ deadline: "2026-09-25T00:00:00.000Z" });
    const task = makeTask(assignment, { estimated_hours: 6 });

    const { blocks } = scheduleTasks("u1", baseInput({ tasks: [task] }));

    const hasEarlyMorningBlockOnLaterDay = blocks.some((b) => {
      const start = new Date(b.start_time);
      const isLaterDay = start.getUTCDate() !== NOW.getUTCDate();
      const hour = start.getUTCHours();
      return isLaterDay && hour < 8;
    });

    expect(hasEarlyMorningBlockOnLaterDay).toBe(false);
  });
});

describe("scheduleTasks — determinism", () => {
  it("produces identical output across repeated runs with the same input", () => {
    const assignment = makeAssignment();
    const task = makeTask(assignment, { estimated_hours: 3 });
    const input = baseInput({ tasks: [task] });

    const a = scheduleTasks("u1", input);
    const b = scheduleTasks("u1", input);

    expect(a.blocks).toEqual(b.blocks);
    expect(a.atRisk.length).toEqual(b.atRisk.length);
  });
});

describe("scheduleTasks — panic detection and priority ordering survive the rewrite", () => {
  it("still flags a task as panic when its deadline is within the hard 24h threshold", () => {
    const assignment = makeAssignment({
      deadline: new Date(NOW.getTime() + 10 * 3_600_000).toISOString(),
    });
    const task = makeTask(assignment, { estimated_hours: 1 });

    const { panicTaskIds } = scheduleTasks("u1", baseInput({ tasks: [task] }));

    expect(panicTaskIds).toContain(task.id);
  });

  it("gives an urgent-priority assignment's task a turn before a low-priority one competing for the same day", () => {
    const urgentAssignment = makeAssignment({
      priority: "urgent",
      deadline: "2026-08-15T00:00:00.000Z",
    });
    const lowAssignment = makeAssignment({
      priority: "low",
      deadline: "2026-08-15T00:00:00.000Z",
    });
    // Listed low-priority first in the input array -- if priority ordering
    // weren't respected, array order would leak through via the stable
    // sort instead.
    const lowTask = makeTask(lowAssignment, { estimated_hours: 1 });
    const urgentTask = makeTask(urgentAssignment, { estimated_hours: 1 });

    const { blocks } = scheduleTasks("u1", baseInput({ tasks: [lowTask, urgentTask] }));

    const urgentBlock = blocks.find((b) => b.task_id === urgentTask.id)!;
    const lowBlock = blocks.find((b) => b.task_id === lowTask.id)!;

    expect(new Date(urgentBlock.start_time).getTime()).toBeLessThan(
      new Date(lowBlock.start_time).getTime()
    );
  });
});

describe("scheduleTasks — repair, not rebuild (alreadyScheduledHours)", () => {
  it("only schedules the remaining hours when part of a task is already covered by kept blocks", () => {
    const assignment = makeAssignment({ deadline: "2026-08-25T00:00:00.000Z" });
    const task = makeTask(assignment, { estimated_hours: 3 });

    // Pretend 2h of this task is already scheduled elsewhere (a block the
    // caller is keeping, e.g. /api/schedule/run's repair path) -- pass it
    // as an existing block so the algorithm won't double-book it, and tell
    // scheduleTasks about it via alreadyScheduledHours so it only plans
    // the remaining 1h.
    const keptBlock: ScheduledBlock = {
      id: "kept-1",
      user_id: "u1",
      task_id: task.id,
      start_time: "2026-08-11T10:00:00.000Z",
      end_time: "2026-08-11T12:00:00.000Z",
      google_event_id: null,
      is_missed: false,
      created_at: NOW.toISOString(),
    };

    const { blocks } = scheduleTasks(
      "u1",
      baseInput({
        tasks: [task],
        existingBlocks: [keptBlock],
        alreadyScheduledHours: { [task.id]: 2 },
      })
    );

    const newHours = blocks.reduce(
      (sum, b) => sum + (new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / 3_600_000,
      0
    );
    expect(newHours).toBeCloseTo(1, 2);

    // None of the newly-placed blocks should overlap the kept block.
    const keptStart = new Date(keptBlock.start_time).getTime();
    const keptEnd = new Date(keptBlock.end_time).getTime();
    for (const b of blocks) {
      const s = new Date(b.start_time).getTime();
      const e = new Date(b.end_time).getTime();
      expect(s < keptEnd && e > keptStart).toBe(false);
    }
  });

  it("schedules nothing new and doesn't flag at-risk when a task is already fully covered", () => {
    const assignment = makeAssignment({ deadline: "2026-08-25T00:00:00.000Z" });
    const task = makeTask(assignment, { estimated_hours: 2 });

    const { blocks, atRisk } = scheduleTasks(
      "u1",
      baseInput({ tasks: [task], alreadyScheduledHours: { [task.id]: 2 } })
    );

    expect(blocks).toHaveLength(0);
    expect(atRisk).toHaveLength(0);
  });
});

describe("blockOverlapsBlockedTimes", () => {
  it("detects a block that overlaps a blocked time on the matching day", () => {
    const block = { start_time: "2026-08-10T10:00:00.000Z", end_time: "2026-08-10T11:00:00.000Z" }; // Monday
    const blockedTimes: BlockedTime[] = [
      {
        id: "bt1", user_id: "u1", label: "Lecture",
        days: ["Mon"], start_hour: 10.5, end_hour: 12,
        repeat_weekly: true, created_at: NOW.toISOString(),
      } as BlockedTime,
    ];

    expect(blockOverlapsBlockedTimes(block, blockedTimes, "UTC")).toBe(true);
  });

  it("returns false for a block that doesn't overlap any blocked time", () => {
    const block = { start_time: "2026-08-10T10:00:00.000Z", end_time: "2026-08-10T11:00:00.000Z" };
    const blockedTimes: BlockedTime[] = [
      {
        id: "bt1", user_id: "u1", label: "Lecture",
        days: ["Mon"], start_hour: 14, end_hour: 16,
        repeat_weekly: true, created_at: NOW.toISOString(),
      } as BlockedTime,
    ];

    expect(blockOverlapsBlockedTimes(block, blockedTimes, "UTC")).toBe(false);
  });

  it("returns false when the blocked time is on a different day", () => {
    const block = { start_time: "2026-08-10T10:00:00.000Z", end_time: "2026-08-10T11:00:00.000Z" }; // Monday
    const blockedTimes: BlockedTime[] = [
      {
        id: "bt1", user_id: "u1", label: "Lecture",
        days: ["Tue"], start_hour: 10, end_hour: 12,
        repeat_weekly: true, created_at: NOW.toISOString(),
      } as BlockedTime,
    ];

    expect(blockOverlapsBlockedTimes(block, blockedTimes, "UTC")).toBe(false);
  });
});
