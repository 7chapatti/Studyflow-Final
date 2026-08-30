import { describe, it, expect, vi, beforeEach } from "vitest";

const FAKE_USER = { id: "user-1", email: "student@example.com" };

const { requireAuthMock, checkRateLimitMock, portalSessionsCreateMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  portalSessionsCreateMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  requireAuth: requireAuthMock,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  getClientIp: () => "203.0.113.5",
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    billingPortal: { sessions: { create: portalSessionsCreateMock } },
  },
}));

import { POST } from "./route";

function makeRequest() {
  return new Request("https://example.com/api/stripe/portal", { method: "POST" });
}

function fakeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    tier: "premium" as const,
    ai_analyses_used: 0,
    ai_analyses_reset_at: new Date().toISOString(),
    stripe_customer_id: "cus_123",
    ...overrides,
  };
}

describe("Stripe billing portal route", () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    checkRateLimitMock.mockReset();
    portalSessionsCreateMock.mockReset();

    checkRateLimitMock.mockResolvedValue(true);
  });

  it("returns 401 when the caller isn't authenticated", async () => {
    requireAuthMock.mockResolvedValue({
      user: null,
      profile: null,
      error: new Response(JSON.stringify({ error: "Unauthorised" }), { status: 401 }),
    });

    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
    expect(portalSessionsCreateMock).not.toHaveBeenCalled();
  });

  it("returns 429 and never calls Stripe when rate limited", async () => {
    requireAuthMock.mockResolvedValue({ user: FAKE_USER, profile: fakeProfile(), error: null });
    checkRateLimitMock.mockResolvedValue(false);

    const response = await POST(makeRequest());

    expect(response.status).toBe(429);
    expect(portalSessionsCreateMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a user with no Stripe customer id yet, without calling Stripe", async () => {
    requireAuthMock.mockResolvedValue({
      user: FAKE_USER,
      profile: fakeProfile({ stripe_customer_id: null }),
      error: null,
    });

    const response = await POST(makeRequest());

    expect(response.status).toBe(400);
    expect(portalSessionsCreateMock).not.toHaveBeenCalled();
  });

  it("creates a portal session for the caller's own Stripe customer id and returns its URL", async () => {
    requireAuthMock.mockResolvedValue({ user: FAKE_USER, profile: fakeProfile(), error: null });
    portalSessionsCreateMock.mockResolvedValue({ url: "https://billing.stripe.com/session/abc" });

    const response = await POST(makeRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.url).toBe("https://billing.stripe.com/session/abc");
    expect(portalSessionsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_123" })
    );
  });

  it("returns 500 if Stripe itself errors", async () => {
    requireAuthMock.mockResolvedValue({ user: FAKE_USER, profile: fakeProfile(), error: null });
    portalSessionsCreateMock.mockRejectedValue(new Error("stripe down"));

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
  });
});
