import { describe, it, expect } from "vitest";
import { scheduleTasks, type ScheduleInput } from "./scheduler";
import type { Task, Assignment, BlockedTime } from "@/types";

const NOW = new Date("2026-08-10T17:13:42.000Z");
const TZ = "UTC";

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

function makeTask(assignment: Assignment, overrides: Partial<Task> = {}): Task & { assignment: Assignment } {
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

describe("scheduleTasks — slot grid stays half-hour aligned even when 'now' isn't", () => {
  it("never produces a block starting on an off-grid minute", () => {
    const assignment = makeAssignment({ deadline: "2026-08-12T00:00:00.000Z", priority: "urgent" });
    const tasks = [
      makeTask(assignment, { name: "T1", estimated_hours: 2 }),
      makeTask(assignment, { name: "T2", estimated_hours: 2 }),
      makeTask(assignment, { name: "T3", estimated_hours: 1 }),
    ];

    const { blocks } = scheduleTasks("u1", baseInput({ tasks }));
    expect(blocks.length).toBeGreaterThan(0);

    for (const b of blocks) {
      const minutes = new Date(b.start_time).getUTCMinutes();
      expect(minutes === 0 || minutes === 30).toBe(true);
    }
  });

  it("never schedules into a blocked time that starts right after an off-grid 'now'", () => {
    const assignment = makeAssignment({ deadline: "2026-08-11T00:00:00.000Z", priority: "urgent" });
    const task = makeTask(assignment, { estimated_hours: 3 });
    const blockedTimes: BlockedTime[] = [
      {
        id: "bt1", user_id: "u1", label: "Evening commitment",
        days: ["Mon"], start_hour: 17.5, end_hour: 22,
        repeat_weekly: true, created_at: NOW.toISOString(),
      } as BlockedTime,
    ];

    const { blocks } = scheduleTasks("u1", baseInput({ tasks: [task], blockedTimes }));

    for (const b of blocks) {
      const start = new Date(b.start_time);
      const end = new Date(b.end_time);
      if (start.getUTCDay() !== 1) continue;
      const startHour = start.getUTCHours() + start.getUTCMinutes() / 60;
      const endHour = end.getUTCHours() + end.getUTCMinutes() / 60;
      const overlapsBlockedTime = startHour < 22 && endHour > 17.5;
      expect(overlapsBlockedTime).toBe(false);
    }
  });
});

const GLOBAL_BUDGET_TEST_CEILING = 4;

describe("scheduleTasks — global daily budget spreads unrelated assignments across days", () => {
  it("doesn't pile every relaxed assignment's turns onto the first one or two days", () => {
    const deadline = "2026-08-31T00:00:00.000Z";
    const tasks = Array.from({ length: 6 }, (_, i) =>
      makeTask(makeAssignment({ name: `Course ${i}`, deadline }), { estimated_hours: 3 })
    );

    const { blocks } = scheduleTasks("u1", baseInput({ tasks }));

    const hoursByDay = new Map<string, number>();
    for (const b of blocks) {
      const day = dayKeyUTC(b.start_time);
      const hours = (new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / 3_600_000;
      hoursByDay.set(day, (hoursByDay.get(day) ?? 0) + hours);
    }

    expect(hoursByDay.size).toBeGreaterThan(2);
    for (const hours of hoursByDay.values()) {
      expect(hours).toBeLessThanOrEqual(4);
    }
  });

  it("still lets a genuinely large combined crunch exceed the global budget when the work is actually due that soon", () => {
    const dueSoon = "2026-08-11T20:00:00.000Z";
    const tasks = [
      makeTask(makeAssignment({ deadline: dueSoon, priority: "urgent" }), { estimated_hours: 8 }),
      makeTask(makeAssignment({ deadline: dueSoon, priority: "urgent" }), { estimated_hours: 8 }),
    ];

    const { blocks } = scheduleTasks("u1", baseInput({ tasks }));

    const hoursByDay = new Map<string, number>();
    for (const b of blocks) {
      const day = dayKeyUTC(b.start_time);
      const hours = (new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / 3_600_000;
      hoursByDay.set(day, (hoursByDay.get(day) ?? 0) + hours);
    }

    expect(Math.max(...hoursByDay.values())).toBeGreaterThan(GLOBAL_BUDGET_TEST_CEILING);
  });
});

describe("scheduleTasks — breaks between turns for relaxed work, none required for panic work", () => {
  it("leaves a gap between two different tasks' turns on the same day when neither is urgent", () => {
    const deadline = "2026-08-30T00:00:00.000Z";
    const assignment = makeAssignment({ deadline });
    const tasks = [
      makeTask(assignment, { name: "T1", estimated_hours: 2 }),
      makeTask(assignment, { name: "T2", estimated_hours: 2 }),
    ];

    const { blocks } = scheduleTasks("u1", baseInput({ tasks }));
    const sorted = [...blocks].sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = new Date(sorted[i - 1].end_time).getTime();
      const nextStart = new Date(sorted[i].start_time).getTime();
      const gapMinutes = (nextStart - prevEnd) / 60_000;
      if (gapMinutes >= 0 && gapMinutes < 12 * 60) {
        expect(gapMinutes).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it("allows panic turns to sit back-to-back with no gap", () => {
    const dueSoon = new Date(NOW.getTime() + 20 * 3_600_000).toISOString();
    const assignment = makeAssignment({ deadline: dueSoon, priority: "urgent" });
    const tasks = [
      makeTask(assignment, { name: "T1", estimated_hours: 1 }),
      makeTask(assignment, { name: "T2", estimated_hours: 1 }),
      makeTask(assignment, { name: "T3", estimated_hours: 1 }),
    ];

    const { blocks, panicTaskIds } = scheduleTasks("u1", baseInput({ tasks }));
    expect(panicTaskIds.length).toBeGreaterThan(0);

    const sorted = [...blocks].sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );
    const hasBackToBack = sorted.some(
      (b, i) => i > 0 && new Date(sorted[i - 1].end_time).getTime() === new Date(b.start_time).getTime()
    );
    expect(hasBackToBack).toBe(true);
  });
});

describe("scheduleTasks — an assignment's own separate small tasks spread across days", () => {
  it("doesn't stack several short tasks from one assignment onto the same day when the deadline is days away", () => {
    const deadline = new Date(NOW.getTime() + 4 * 24 * 3_600_000).toISOString();
    const assignment = makeAssignment({ name: "cyber", deadline });
    const tasks = ["Introduction to Firewalls", "Types of Firewalls", "Firewall Configuration"].map(
      (name) => makeTask(assignment, { name, estimated_hours: 1 })
    );
    const blockedTimes: BlockedTime[] = [
      {
        id: "work", user_id: "u1", label: "work",
        days: ["Mon", "Tue", "Wed", "Thu", "Fri"], start_hour: 9, end_hour: 17,
        repeat_weekly: true, created_at: NOW.toISOString(),
      } as BlockedTime,
    ];

    const { blocks } = scheduleTasks("u1", baseInput({ tasks, blockedTimes }));
    const days = new Set(blocks.map((b) => dayKeyUTC(b.start_time)));

    expect(days.size).toBe(3);
  });

  it("still allows more than one session per day when a single task's own pace genuinely requires it", () => {
    const deadline = new Date(NOW.getTime() + 6 * 3_600_000).toISOString();
    const assignment = makeAssignment({ name: "cyber", deadline, priority: "urgent" });
    const task = makeTask(assignment, { name: "T1", estimated_hours: 3 });

    const { blocks, atRisk } = scheduleTasks("u1", baseInput({ tasks: [task] }));
    expect(atRisk).toHaveLength(0);
    const totalHours = blocks.reduce(
      (sum, b) => sum + (new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / 3_600_000,
      0
    );
    expect(totalHours).toBeCloseTo(3, 1);
    const days = new Set(blocks.map((b) => dayKeyUTC(b.start_time)));
    expect(days.size).toBe(1);
  });
});

describe("scheduleTasks — equal-scoring windows prefer the one with more slack", () => {
  it("doesn't squeeze into a one-hour gap before a blocked time when a wide-open window scores the same", () => {
    const deadline = new Date(NOW.getTime() + 4 * 24 * 3_600_000).toISOString();
    const assignment = makeAssignment({ deadline });
    const task = makeTask(assignment, { estimated_hours: 1 });
    const blockedTimes: BlockedTime[] = [
      {
        id: "work", user_id: "u1", label: "work",
        days: ["Mon", "Tue", "Wed", "Thu", "Fri"], start_hour: 9, end_hour: 17,
        repeat_weekly: true, created_at: NOW.toISOString(),
      } as BlockedTime,
    ];

    const { blocks } = scheduleTasks("u1", baseInput({ tasks: [task], blockedTimes }));
    expect(blocks).toHaveLength(1);
    const start = new Date(blocks[0].start_time);
    expect(start.getUTCHours()).toBeGreaterThanOrEqual(17);
  });
});
