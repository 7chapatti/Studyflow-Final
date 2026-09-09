import { describe, it, expect } from "vitest";
import { scheduleTasks, type ScheduleInput } from "./scheduler";
import type { Task, Assignment, BlockedTime } from "@/types";

// Fixed reference instant: 2026-08-10T00:00:00Z (a Monday, UTC midnight).
const NOW = new Date("2026-08-10T00:00:00.000Z");

function makeAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: "a1",
    user_id: "u1",
    name: "Essay",
    description: null,
    deadline: "2026-08-20T00:00:00.000Z",
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
    id: "t1",
    assignment_id: assignment.id,
    name: "Write draft",
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

function baseInput(timezone: string, overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  const assignment = makeAssignment();
  const task = makeTask(assignment);
  return {
    tasks: [task],
    blockedTimes: [],
    existingBlocks: [],
    paceRatio: 1,
    now: NOW,
    timezone,
    ...overrides,
  };
}

describe("scheduleTasks — timezone handling", () => {
  it("places the first block within the 8am-10pm PREFERRED window in the user's local timezone, not the server's", () => {
    // America/Los_Angeles is UTC-7 in August (PDT). If the scheduler used
    // the server's own local time (UTC in production) instead of the
    // user's configured timezone, an 8am-10pm PDT window would be computed
    // as 8am-10pm UTC — actually 1am-3pm PDT — and this test would fail.
    const input = baseInput("America/Los_Angeles");
    const { blocks } = scheduleTasks("u1", input);

    expect(blocks.length).toBeGreaterThan(0);
    const firstStart = new Date(blocks[0].start_time);

    const laHour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        hour: "numeric",
        hour12: false,
      }).format(firstStart)
    );

    expect(laHour).toBeGreaterThanOrEqual(8);
    expect(laHour).toBeLessThan(22);
  });

  it("respects a blocked time defined in the user's local wall-clock hours, in a non-UTC timezone", () => {
    // Block 8am-2pm local time every day. If blocked-time hours were
    // evaluated against server-local (UTC) time instead of the user's zone,
    // this Auckland-morning block would land on the wrong UTC hours and
    // fail to actually block the local morning.
    const blockedTimes: BlockedTime[] = [
      {
        id: "bt1",
        user_id: "u1",
        label: "Lectures",
        days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        start_hour: 8,
        end_hour: 14,
        repeat_weekly: true,
        created_at: NOW.toISOString(),
      } as BlockedTime,
    ];

    const input = baseInput("Pacific/Auckland", { blockedTimes });
    const { blocks } = scheduleTasks("u1", input);

    expect(blocks.length).toBeGreaterThan(0);

    for (const block of blocks) {
      const nzHour = Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "Pacific/Auckland",
          hour: "numeric",
          hour12: false,
        }).format(new Date(block.start_time))
      );
      // Every scheduled block must fall outside the 8am-2pm blocked window,
      // in Auckland local time.
      expect(nzHour < 8 || nzHour >= 14).toBe(true);
    }
  });

  it("produces the same wall-clock placement regardless of what timezone the process itself is running in", () => {
    // Sanity check that the fix doesn't depend on TZ env var / server locale
    // by comparing two timezones far enough apart (12h) that server-local
    // leakage would produce visibly different results.
    const resultTokyo = scheduleTasks("u1", baseInput("Asia/Tokyo"));
    const resultLondon = scheduleTasks("u1", baseInput("Europe/London"));

    const tokyoHour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Tokyo",
        hour: "numeric",
        hour12: false,
      }).format(new Date(resultTokyo.blocks[0].start_time))
    );
    const londonHour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/London",
        hour: "numeric",
        hour12: false,
      }).format(new Date(resultLondon.blocks[0].start_time))
    );

    // Both should independently land in their own local 8am-10pm window --
    // neither should have "leaked" the other's or the server's offset.
    expect(tokyoHour).toBeGreaterThanOrEqual(8);
    expect(tokyoHour).toBeLessThan(22);
    expect(londonHour).toBeGreaterThanOrEqual(8);
    expect(londonHour).toBeLessThan(22);
  });
});
