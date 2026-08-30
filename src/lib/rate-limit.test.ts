import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Supabase service client before importing the module under test,
// so checkRateLimit() never touches a real database.
const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ rpc: rpcMock }),
}));

import { getClientIp, checkRateLimit } from "./rate-limit";

describe("getClientIp", () => {
  it("uses the first entry of a comma-separated x-forwarded-for", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" },
    });
    expect(getClientIp(request)).toBe("203.0.113.5");
  });

  it("trims whitespace around the extracted IP", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "  203.0.113.5  , 10.0.0.1" },
    });
    expect(getClientIp(request)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const request = new Request("https://example.com", {
      headers: { "x-real-ip": "198.51.100.7" },
    });
    expect(getClientIp(request)).toBe("198.51.100.7");
  });

  it("falls back to 'unknown' when neither header is present", () => {
    const request = new Request("https://example.com");
    expect(getClientIp(request)).toBe("unknown");
  });

  it("prefers x-forwarded-for over x-real-ip when both are present", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "203.0.113.5",
        "x-real-ip": "198.51.100.7",
      },
    });
    expect(getClientIp(request)).toBe("203.0.113.5");
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("calls check_rate_limit with the given key/max/window and returns its result", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });

    const allowed = await checkRateLimit("ai-analyse:1.2.3.4", 20, 600);

    expect(allowed).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("check_rate_limit", {
      p_key: "ai-analyse:1.2.3.4",
      p_max_requests: 20,
      p_window_seconds: 600,
    });
  });

  it("returns false when the RPC reports the limit was exceeded", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });

    const allowed = await checkRateLimit("ai-analyse:1.2.3.4", 20, 600);

    expect(allowed).toBe(false);
  });

  it("fails open (returns true) when the RPC errors", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "db down" } });

    const allowed = await checkRateLimit("ai-analyse:1.2.3.4", 20, 600);

    expect(allowed).toBe(true);
  });

  it("fails open (returns true) when the RPC call throws", async () => {
    rpcMock.mockRejectedValue(new Error("network error"));

    const allowed = await checkRateLimit("ai-analyse:1.2.3.4", 20, 600);

    expect(allowed).toBe(true);
  });
});
