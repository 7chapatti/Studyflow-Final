import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks for the two Supabase client factories used throughout lib/api.ts.
// createClient() backs the user-session-scoped calls (auth.getUser, the two
// RPCs); createServiceClient() backs the profile lookup in requireAuth,
// which intentionally reads with elevated privilege since a brand new user
// may not have RLS-visible rows yet in every edge case.
const getUserMock = vi.fn();
const rpcMock = vi.fn();
const singleMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: getUserMock },
    rpc: rpcMock,
  }),
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: singleMock,
        }),
      }),
    }),
  }),
}));

import { requireAuth, consumeAIQuota, refundAIQuota } from "./api";
import type { Profile } from "@/types";

const FAKE_USER = { id: "user-1", email: "student@example.com" };
const FAKE_PROFILE: Profile = {
  id: "user-1",
  name: "Test Student",
  tier: "free",
  ai_analyses_used: 0,
  ai_analyses_reset_at: new Date().toISOString(),
  storage_used_bytes: 0,
  google_calendar_connected: false,
  timezone: "Europe/London",
  stripe_customer_id: null,
  created_at: new Date().toISOString(),
} as Profile;

describe("requireAuth", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    singleMock.mockReset();
  });

  it("returns a 401 error when there is no authenticated user", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const result = await requireAuth();

    expect(result.user).toBeNull();
    expect(result.profile).toBeNull();
    expect(result.error).not.toBeNull();
    expect(result.error?.status).toBe(401);
  });

  it("returns a 401 error when auth.getUser() itself errors", async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid token" },
    });

    const result = await requireAuth();

    expect(result.error?.status).toBe(401);
  });

  it("returns a 404 error when the user has no profile row", async () => {
    getUserMock.mockResolvedValue({ data: { user: FAKE_USER }, error: null });
    singleMock.mockResolvedValue({ data: null, error: { message: "not found" } });

    const result = await requireAuth();

    expect(result.user).toBeNull();
    expect(result.error?.status).toBe(404);
  });

  it("returns the user and profile on success, with no error", async () => {
    getUserMock.mockResolvedValue({ data: { user: FAKE_USER }, error: null });
    singleMock.mockResolvedValue({ data: FAKE_PROFILE, error: null });

    const result = await requireAuth();

    expect(result.error).toBeNull();
    expect(result.user).toEqual({ id: FAKE_USER.id, email: FAKE_USER.email });
    expect(result.profile).toEqual(FAKE_PROFILE);
  });
});

describe("consumeAIQuota", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("returns allowed=true with the reservation id on success", async () => {
    rpcMock.mockReturnValue({
      single: () =>
        Promise.resolve({
          data: { allowed: true, used: 1, limit: 3, reservation_id: "res-1" },
          error: null,
        }),
    });

    const result = await consumeAIQuota(FAKE_PROFILE);

    expect(result.allowed).toBe(true);
    expect(result.reservationId).toBe("res-1");
    expect(result.limit).toBe(3);
    expect(rpcMock).toHaveBeenCalledWith("consume_ai_analysis");
  });

  it("returns allowed=false with a null reservation id when quota is exhausted", async () => {
    rpcMock.mockReturnValue({
      single: () =>
        Promise.resolve({
          data: { allowed: false, used: 3, limit: 3, reservation_id: null },
          error: null,
        }),
    });

    const result = await consumeAIQuota(FAKE_PROFILE);

    expect(result.allowed).toBe(false);
    expect(result.reservationId).toBeNull();
  });

  it("falls back to the client-known tier limit for display only if the RPC returns 0", async () => {
    rpcMock.mockReturnValue({
      single: () =>
        Promise.resolve({
          data: { allowed: true, used: 1, limit: 0, reservation_id: "res-2" },
          error: null,
        }),
    });

    const result = await consumeAIQuota(FAKE_PROFILE);

    // free tier's aiAnalysesPerMonth from TIER_LIMITS
    expect(result.limit).toBe(3);
  });

  it("throws when the RPC errors, so the caller never proceeds to a paid OpenAI call", async () => {
    rpcMock.mockReturnValue({
      single: () => Promise.resolve({ data: null, error: { message: "db error" } }),
    });

    await expect(consumeAIQuota(FAKE_PROFILE)).rejects.toBeTruthy();
  });
});

describe("refundAIQuota", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("does nothing when reservationId is null (nothing was ever reserved)", async () => {
    await refundAIQuota(null);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("calls refund_ai_analysis with the given reservation id", async () => {
    rpcMock.mockResolvedValue({ error: null });

    await refundAIQuota("res-1");

    expect(rpcMock).toHaveBeenCalledWith("refund_ai_analysis", {
      p_reservation_id: "res-1",
    });
  });

  it("does not throw if the refund RPC errors -- it only logs", async () => {
    rpcMock.mockResolvedValue({ error: { message: "already refunded" } });

    await expect(refundAIQuota("res-1")).resolves.toBeUndefined();
  });
});
