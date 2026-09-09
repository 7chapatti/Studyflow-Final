import { describe, it, expect } from "vitest";
import {
  SignUpSchema,
  LogInSchema,
  CreateAssignmentSchema,
  CreateAssignmentWithPlanSchema,
  BlockedTimeSchema,
  UpdateTaskSchema,
} from "./validation";

describe("SignUpSchema", () => {
  const valid = { name: "Jamie Lee", email: "jamie@example.com", password: "Password1" };

  it("accepts a valid signup payload", () => {
    expect(SignUpSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a password with no uppercase letter", () => {
    const result = SignUpSchema.safeParse({ ...valid, password: "password1" });
    expect(result.success).toBe(false);
  });

  it("rejects a password with no number", () => {
    const result = SignUpSchema.safeParse({ ...valid, password: "Passwordonly" });
    expect(result.success).toBe(false);
  });

  it("rejects a password under 8 characters even if it meets the other rules", () => {
    const result = SignUpSchema.safeParse({ ...valid, password: "Pw1" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = SignUpSchema.safeParse({ ...valid, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("lowercases and trims the email", () => {
    const result = SignUpSchema.safeParse({ ...valid, email: "  Jamie@Example.COM  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("jamie@example.com");
  });

  it("rejects a name that's just whitespace", () => {
    const result = SignUpSchema.safeParse({ ...valid, name: "   " });
    expect(result.success).toBe(false);
  });
});

describe("Trim-then-validate ordering (regression coverage)", () => {
  // Every trimmed string field in validation.ts had the same bug at some
  // point: length/format checks ran on the *untrimmed* value, so
  // whitespace-only input could pass a min-length check and end up stored
  // as empty after trimming, and valid-but-padded input could fail a
  // format check that should only apply to the cleaned value. Fixed by
  // moving .trim()/.toLowerCase() to the front of each chain -- this
  // covers every field that pattern touched, not just the ones the first
  // pass of tests happened to catch it on.

  it("CreateAssignmentSchema.name: rejects whitespace-only, trims real content", () => {
    const base = { deadline: "2026-12-01T00:00:00.000Z", priority: "normal" as const };
    expect(CreateAssignmentSchema.safeParse({ ...base, name: "   " }).success).toBe(false);
    const result = CreateAssignmentSchema.safeParse({ ...base, name: "  Essay  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Essay");
  });

  it("AssignmentSectionSchema (via CreateAssignmentWithPlanSchema): rejects a whitespace-only section name", () => {
    const base = {
      name: "Essay",
      deadline: "2026-12-01T00:00:00.000Z",
      priority: "normal" as const,
    };
    const result = CreateAssignmentWithPlanSchema.safeParse({
      ...base,
      sections: [{ name: "   ", hours: 2 }],
    });
    expect(result.success).toBe(false);
  });

  it("AssignmentChecklistItemSchema (via CreateAssignmentWithPlanSchema): rejects a whitespace-only checklist label", () => {
    const base = {
      name: "Essay",
      deadline: "2026-12-01T00:00:00.000Z",
      priority: "normal" as const,
    };
    const result = CreateAssignmentWithPlanSchema.safeParse({
      ...base,
      checklist: [{ category: "other" as const, label: "   " }],
    });
    expect(result.success).toBe(false);
  });

  it("BlockedTimeSchema.label: rejects a whitespace-only label", () => {
    const result = BlockedTimeSchema.safeParse({
      label: "   ",
      days: ["Mon"],
      start_hour: 9,
      end_hour: 11,
      repeat_weekly: true,
    });
    expect(result.success).toBe(false);
  });

  it("LogInSchema.email: accepts and normalises a padded, mixed-case email the same as signup", () => {
    const result = LogInSchema.safeParse({ email: "  Jamie@Example.COM  ", password: "x" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("jamie@example.com");
  });
});

describe("LogInSchema", () => {
  it("does not enforce password complexity on login (only that it's present)", () => {
    const result = LogInSchema.safeParse({ email: "a@b.com", password: "x" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty password", () => {
    const result = LogInSchema.safeParse({ email: "a@b.com", password: "" });
    expect(result.success).toBe(false);
  });
});

describe("CreateAssignmentSchema", () => {
  const valid = {
    name: "Essay",
    deadline: "2026-12-01T00:00:00.000Z",
    priority: "normal" as const,
  };

  it("accepts a minimal valid payload (description is optional)", () => {
    expect(CreateAssignmentSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an unparseable deadline string", () => {
    const result = CreateAssignmentSchema.safeParse({ ...valid, deadline: "next Tuesday" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid priority value", () => {
    const result = CreateAssignmentSchema.safeParse({ ...valid, priority: "asap" });
    expect(result.success).toBe(false);
  });

  it("rejects a name over 200 characters", () => {
    const result = CreateAssignmentSchema.safeParse({ ...valid, name: "x".repeat(201) });
    expect(result.success).toBe(false);
  });
});

describe("CreateAssignmentWithPlanSchema — the server-side re-validation boundary for AI-derived content", () => {
  const base = {
    name: "Essay",
    deadline: "2026-12-01T00:00:00.000Z",
    priority: "normal" as const,
  };

  it("defaults sections and checklist to empty arrays when omitted", () => {
    const result = CreateAssignmentWithPlanSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sections).toEqual([]);
      expect(result.data.checklist).toEqual([]);
    }
  });

  it("rejects a section with hours above the 24h ceiling", () => {
    const result = CreateAssignmentWithPlanSchema.safeParse({
      ...base,
      sections: [{ name: "Draft", hours: 25 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a section with hours at or below zero", () => {
    const result = CreateAssignmentWithPlanSchema.safeParse({
      ...base,
      sections: [{ name: "Draft", hours: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 10 sections", () => {
    const result = CreateAssignmentWithPlanSchema.safeParse({
      ...base,
      sections: Array.from({ length: 11 }, (_, i) => ({ name: `S${i}`, hours: 1 })),
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 15 checklist items", () => {
    const result = CreateAssignmentWithPlanSchema.safeParse({
      ...base,
      checklist: Array.from({ length: 16 }, (_, i) => ({
        category: "other" as const,
        label: `Item ${i}`,
      })),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a checklist item with an unrecognized category", () => {
    const result = CreateAssignmentWithPlanSchema.safeParse({
      ...base,
      checklist: [{ category: "bibliography", label: "Cite sources" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed section and checklist item together", () => {
    const result = CreateAssignmentWithPlanSchema.safeParse({
      ...base,
      sections: [{ name: "Draft", hours: 3, confidence: 0.8, description: "Write it" }],
      checklist: [{ category: "word_limit", label: "2000 words", confidence: 0.9 }],
    });
    expect(result.success).toBe(true);
  });
});

describe("BlockedTimeSchema — cross-field refine", () => {
  const base = {
    label: "Lectures",
    days: ["Mon" as const],
    repeat_weekly: true,
  };

  it("accepts a valid range where end is after start", () => {
    const result = BlockedTimeSchema.safeParse({ ...base, start_hour: 9, end_hour: 11 });
    expect(result.success).toBe(true);
  });

  it("rejects end_hour equal to start_hour", () => {
    const result = BlockedTimeSchema.safeParse({ ...base, start_hour: 9, end_hour: 9 });
    expect(result.success).toBe(false);
  });

  it("rejects end_hour before start_hour", () => {
    const result = BlockedTimeSchema.safeParse({ ...base, start_hour: 14, end_hour: 9 });
    expect(result.success).toBe(false);
  });

  it("rejects an empty days array", () => {
    const result = BlockedTimeSchema.safeParse({ ...base, days: [], start_hour: 9, end_hour: 11 });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid day abbreviation", () => {
    const result = BlockedTimeSchema.safeParse({
      ...base,
      days: ["Monday"],
      start_hour: 9,
      end_hour: 11,
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdateTaskSchema", () => {
  it("accepts a partial update with just a status change", () => {
    expect(UpdateTaskSchema.safeParse({ status: "done" }).success).toBe(true);
  });

  it("rejects actual_hours above the 24h ceiling", () => {
    expect(UpdateTaskSchema.safeParse({ actual_hours: 25 }).success).toBe(false);
  });

  it("accepts an explicit null for started_at (clearing it)", () => {
    expect(UpdateTaskSchema.safeParse({ started_at: null }).success).toBe(true);
  });

  it("rejects an invalid status value", () => {
    expect(UpdateTaskSchema.safeParse({ status: "archived" }).success).toBe(false);
  });
});
