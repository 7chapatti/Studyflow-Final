import { describe, it, expect } from "vitest";
import { toZonedTime } from "date-fns-tz";
import { scheduleTasks, type ScheduleInput } from "./scheduler";
import type { Task, Assignment, BlockedTime } from "@/types";

// Monday 2026-08-10, 09:00 UTC.
const NOW = new Date("2026-08-10T09:00:00.000Z");

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
    timezone: "UTC",
    ...overrides,
  };
}

function localHours(iso: string, timezone: string): number {
  const zoned = toZonedTime(new Date(iso), timezone);
  return zoned.getHours() + zoned.getMinutes() / 60;
}

function blockHours(block: { start_time: string; end_time: string }): number {
  return (new Date(block.end_time).getTime() - new Date(block.start_time).getTime()) / 3_600_000;
}

function hoursByDay(blocks: Array<{ start_time: string; end_time: string }>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const b of blocks) {
    const day = b.start_time.slice(0, 10);
    totals.set(day, (totals.get(day) ?? 0) + blockHours(b));
  }
  return totals;
}

describe("scheduleTasks — never books sleeping hours", () => {
  it("keeps every block between 06:00 and midnight even when two deadlines are a day away", () => {
    const dueSoon = "2026-08-11T20:00:00.000Z";
    const a = makeAssignment({ deadline: dueSoon, priority: "urgent" });
    const b = makeAssignment({ deadline: dueSoon, priority: "urgent" });

    const { blocks } = scheduleTasks(
      "u1",
      baseInput({ tasks: [makeTask(a, { estimated_hours: 8 }), makeTask(b, { estimated_hours: 8 })] })
    );

    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const start = localHours(block.start_time, "UTC");
      const end = start + blockHours(block);
      expect(start).toBeGreaterThanOrEqual(6);
      expect(end).toBeLessThanOrEqual(24);
    }
  });

  it("applies the same rule in the user's own timezone, not the server's", () => {
    const tz = "America/New_York";
    const dueSoon = "2026-08-11T20:00:00.000Z";
    const a = makeAssignment({ deadline: dueSoon, priority: "urgent" });

    const { blocks } = scheduleTasks(
      "u1",
      baseInput({ tasks: [makeTask(a, { estimated_hours: 12 })], timezone: tz })
    );

    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const start = localHours(block.start_time, tz);
      expect(start).toBeGreaterThanOrEqual(6);
      expect(start + blockHours(block)).toBeLessThanOrEqual(24);
    }
  });

  it("doesn't offer the middle of the night just because that's when it was run", () => {
    const twoAm = new Date("2026-08-10T02:00:00.000Z");
    const a = makeAssignment({ deadline: "2026-08-10T23:00:00.000Z", priority: "urgent" });

    const { blocks } = scheduleTasks(
      "u1",
      baseInput({ tasks: [makeTask(a, { estimated_hours: 3 })], now: twoAm })
    );

    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(localHours(block.start_time, "UTC")).toBeGreaterThanOrEqual(6);
    }
  });

  it("reports work as at risk rather than squeezing it into the night", () => {
    // 20:00 now, due 09:00 tomorrow, 8h of work. Waking hours before the
    // 2h deadline buffer: 20:00-24:00 tonight and 06:00-07:00 tomorrow.
    const evening = new Date("2026-08-10T20:00:00.000Z");
    const a = makeAssignment({ deadline: "2026-08-11T09:00:00.000Z", priority: "urgent" });
    const task = makeTask(a, { estimated_hours: 8 });

    const { blocks, atRisk } = scheduleTasks("u1", baseInput({ tasks: [task], now: evening }));

    const scheduled = blocks.reduce((sum, b) => sum + blockHours(b), 0);
    expect(scheduled).toBeLessThan(8);
    expect(atRisk.map((r) => r.task.id)).toContain(task.id);
    for (const block of blocks) {
      expect(localHours(block.start_time, "UTC")).toBeGreaterThanOrEqual(6);
    }
  });
});

describe("scheduleTasks — fills earlier days before spilling onto later ones", () => {
  it("uses today's free evening instead of leaving it empty and overloading deadline day", () => {
    const dueSoon = "2026-08-11T20:00:00.000Z";
    const a = makeAssignment({ deadline: dueSoon, priority: "urgent" });
    const b = makeAssignment({ deadline: dueSoon, priority: "urgent" });

    const { blocks, atRisk } = scheduleTasks(
      "u1",
      baseInput({ tasks: [makeTask(a, { estimated_hours: 8 }), makeTask(b, { estimated_hours: 8 })] })
    );

    const totals = hoursByDay(blocks);
    const today = totals.get("2026-08-10") ?? 0;
    const deadlineDay = totals.get("2026-08-11") ?? 0;

    expect(atRisk).toEqual([]);
    expect(today + deadlineDay).toBeCloseTo(16, 1);
    // The bulk goes on the day with the most room, not the last day.
    expect(today).toBeGreaterThan(deadlineDay);
  });
});

describe("scheduleTasks — relaxed work and the wider day", () => {
  it("stays inside 08:00-22:00 when there is room", () => {
    const a = makeAssignment({ deadline: "2026-09-20T00:00:00.000Z" });

    const { blocks } = scheduleTasks("u1", baseInput({ tasks: [makeTask(a, { estimated_hours: 6 })] }));

    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const start = localHours(block.start_time, "UTC");
      expect(start).toBeGreaterThanOrEqual(8);
      expect(start + blockHours(block)).toBeLessThanOrEqual(22);
    }
  });

  it("falls back to early mornings and late evenings when daytime is fully blocked, instead of giving up", () => {
    const allDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const daytimeBlocked: BlockedTime = {
      id: "bt-1",
      user_id: "u1",
      label: "Work",
      days: allDays,
      start_hour: 8,
      end_hour: 22,
      repeat_weekly: true,
      created_at: NOW.toISOString(),
    } as BlockedTime;

    const a = makeAssignment({ deadline: "2026-09-20T00:00:00.000Z" });
    const task = makeTask(a, { estimated_hours: 4 });

    const { blocks, atRisk } = scheduleTasks(
      "u1",
      baseInput({ tasks: [task], blockedTimes: [daytimeBlocked] })
    );

    expect(atRisk).toEqual([]);
    expect(blocks.reduce((sum, b) => sum + blockHours(b), 0)).toBeCloseTo(4, 1);
    for (const block of blocks) {
      const start = localHours(block.start_time, "UTC");
      const end = start + blockHours(block);
      const earlyMorning = start >= 6 && end <= 8;
      const lateEvening = start >= 22 && end <= 24;
      expect(earlyMorning || lateEvening).toBe(true);
    }
  });
});
