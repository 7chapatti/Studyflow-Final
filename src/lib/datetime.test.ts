import { describe, it, expect } from "vitest";
import { toIsoWithTimezone } from "./datetime";

describe("toIsoWithTimezone", () => {
  it("converts a London evening time correctly during GMT (winter, no DST)", () => {
    // 23:59 on 1 Dec 2026 in Europe/London (GMT, UTC+0 in winter) should be
    // exactly 23:59 UTC.
    const result = toIsoWithTimezone("2026-12-01", "23:59", "Europe/London");
    expect(result).toBe("2026-12-01T23:59:00.000Z");
  });

  it("converts a London evening time correctly during BST (summer, +1h DST)", () => {
    // 23:59 on 1 Jun 2026 in Europe/London (BST, UTC+1 in summer) is
    // 22:59 UTC.
    const result = toIsoWithTimezone("2026-06-01", "23:59", "Europe/London");
    expect(result).toBe("2026-06-01T22:59:00.000Z");
  });

  it("converts a US Eastern time correctly (UTC-5 in winter)", () => {
    const result = toIsoWithTimezone("2026-12-01", "09:00", "America/New_York");
    expect(result).toBe("2026-12-01T14:00:00.000Z");
  });

  it("handles a timezone crossing midnight into the next UTC day", () => {
    // 23:00 in Tokyo (UTC+9) on 1 Jan is 14:00 UTC on 1 Jan -- no day
    // rollover in this direction, but the reverse (early morning Tokyo
    // time rolling back to the previous UTC day) is the interesting case.
    const result = toIsoWithTimezone("2026-01-01", "02:00", "Asia/Tokyo");
    expect(result).toBe("2025-12-31T17:00:00.000Z");
  });

  it("is deterministic for the same input", () => {
    const a = toIsoWithTimezone("2026-03-15", "12:30", "Europe/London");
    const b = toIsoWithTimezone("2026-03-15", "12:30", "Europe/London");
    expect(a).toBe(b);
  });
});
