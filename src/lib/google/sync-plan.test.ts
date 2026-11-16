import { describe, it, expect } from "vitest";
import { eventIdForBlock, planCalendarSync, type DesiredEvent, type ExistingEvent } from "./sync-plan";

function desired(overrides: Partial<DesiredEvent> = {}): DesiredEvent {
  return {
    id: "aaaa",
    summary: "Draft introduction · History essay",
    description: "Study block planned by Duecourse.",
    start: "2026-11-20T10:00:00.000Z",
    end: "2026-11-20T12:00:00.000Z",
    ...overrides,
  };
}

function existingFrom(event: DesiredEvent, overrides: Partial<ExistingEvent> = {}): ExistingEvent {
  return { ...event, status: "confirmed", ...overrides };
}

describe("eventIdForBlock", () => {
  it("turns a block uuid into an id Google accepts", () => {
    const id = eventIdForBlock("3F2504E0-4F89-41D3-9A0C-0305E82C3301");
    expect(id).toBe("3f2504e04f8941d39a0c0305e82c3301");
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
  });
});

describe("planCalendarSync", () => {
  it("creates events for blocks Google doesn't have yet", () => {
    const plan = planCalendarSync([desired()], []);
    expect(plan.create.map((e) => e.id)).toEqual(["aaaa"]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it("does nothing when everything already matches", () => {
    const event = desired();
    const plan = planCalendarSync([event], [existingFrom(event)]);
    expect(plan).toEqual({ create: [], update: [], remove: [] });
  });

  it("treats the same instant in a different offset as unchanged", () => {
    const event = desired();
    const plan = planCalendarSync(
      [event],
      [existingFrom(event, { start: "2026-11-20T11:00:00+01:00", end: "2026-11-20T13:00:00+01:00" })]
    );
    expect(plan).toEqual({ create: [], update: [], remove: [] });
  });

  it("updates an event whose block was moved", () => {
    const event = desired();
    const plan = planCalendarSync(
      [event],
      [existingFrom(event, { start: "2026-11-21T10:00:00.000Z", end: "2026-11-21T12:00:00.000Z" })]
    );
    expect(plan.update.map((e) => e.id)).toEqual(["aaaa"]);
    expect(plan.create).toEqual([]);
  });

  it("updates an event whose task or assignment was renamed", () => {
    const event = desired();
    const plan = planCalendarSync([event], [existingFrom(event, { summary: "Old name" })]);
    expect(plan.update.map((e) => e.id)).toEqual(["aaaa"]);
  });

  it("restores an event the user deleted in Google while its block still exists", () => {
    const event = desired();
    const plan = planCalendarSync([event], [existingFrom(event, { status: "cancelled" })]);
    expect(plan.update.map((e) => e.id)).toEqual(["aaaa"]);
    expect(plan.remove).toEqual([]);
  });

  it("removes events whose block no longer exists", () => {
    const kept = desired({ id: "kept" });
    const gone = desired({ id: "gone" });
    const plan = planCalendarSync([kept], [existingFrom(kept), existingFrom(gone)]);
    expect(plan.remove).toEqual(["gone"]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
  });

  it("doesn't try to remove an event that is already cancelled", () => {
    const gone = desired({ id: "gone" });
    const plan = planCalendarSync([], [existingFrom(gone, { status: "cancelled" })]);
    expect(plan.remove).toEqual([]);
  });

  it("handles a full reorganise: some kept, some moved, some new, some gone", () => {
    const kept = desired({ id: "kept" });
    const moved = desired({ id: "moved", start: "2026-11-22T09:00:00.000Z", end: "2026-11-22T10:00:00.000Z" });
    const fresh = desired({ id: "fresh" });
    const gone = desired({ id: "gone" });

    const plan = planCalendarSync(
      [kept, moved, fresh],
      [existingFrom(kept), existingFrom(moved, { start: "2026-11-20T09:00:00.000Z" }), existingFrom(gone)]
    );

    expect(plan.create.map((e) => e.id)).toEqual(["fresh"]);
    expect(plan.update.map((e) => e.id)).toEqual(["moved"]);
    expect(plan.remove).toEqual(["gone"]);
  });
});
