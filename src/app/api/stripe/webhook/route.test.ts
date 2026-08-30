import { describe, it, expect, vi, beforeEach } from "vitest";

const { PRICE_IDS, constructEventMock, subscriptionsRetrieveMock, insertMock, updateEqMock, updateMock } =
  vi.hoisted(() => {
    const updateEqMock = vi.fn();
    return {
      PRICE_IDS: {
        premium_monthly: "price_premium_month",
        premium_yearly: "price_premium_year",
        pro_monthly: "price_pro_month",
        pro_yearly: "price_pro_year",
      },
      constructEventMock: vi.fn(),
      subscriptionsRetrieveMock: vi.fn(),
      insertMock: vi.fn(),
      updateEqMock,
      updateMock: vi.fn(() => ({ eq: updateEqMock })),
    };
  });

vi.mock("@/lib/stripe", () => ({
  stripe: {
    webhooks: { constructEvent: constructEventMock },
    subscriptions: { retrieve: subscriptionsRetrieveMock },
  },
  PLANS: {
    premium_monthly: { priceId: PRICE_IDS.premium_monthly, tier: "premium" },
    premium_yearly: { priceId: PRICE_IDS.premium_yearly, tier: "premium" },
    pro_monthly: { priceId: PRICE_IDS.pro_monthly, tier: "pro" },
    pro_yearly: { priceId: PRICE_IDS.pro_yearly, tier: "pro" },
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: insertMock,
      update: updateMock,
    }),
  }),
}));

import { POST } from "./route";

function makeRequest(body: string, signature = "valid-sig") {
  return new Request("https://example.com/api/stripe/webhook", {
    method: "POST",
    body,
    headers: signature ? { "stripe-signature": signature } : undefined,
  });
}

describe("Stripe webhook route", () => {
  beforeEach(() => {
    constructEventMock.mockReset();
    subscriptionsRetrieveMock.mockReset();
    insertMock.mockReset();
    updateEqMock.mockReset();
    updateMock.mockClear();

    insertMock.mockResolvedValue({ error: null });
    updateEqMock.mockResolvedValue({ error: null });
  });

  it("rejects a request with no stripe-signature header", async () => {
    const request = makeRequest("{}", "");
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(constructEventMock).not.toHaveBeenCalled();
  });

  it("rejects a request whose signature fails verification", async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error("bad signature");
    });

    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toMatch(/invalid signature/i);
  });

  it("short-circuits on a duplicate event id without reprocessing", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_123",
      type: "checkout.session.completed",
      data: { object: {} },
    });
    insertMock.mockResolvedValue({ error: { code: "23505" } });

    const response = await POST(makeRequest("{}"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.duplicate).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("applies the correct tier on checkout.session.completed with valid metadata", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          customer: "cus_1",
          metadata: { supabase_user_id: "user-1", plan: "pro" },
        },
      },
    });

    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({
      tier: "pro",
      stripe_customer_id: "cus_1",
    });
    expect(updateEqMock).toHaveBeenCalledWith("id", "user-1");
  });

  it("does not update anything when checkout metadata is missing the plan", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_2",
      type: "checkout.session.completed",
      data: { object: { id: "cs_2", metadata: { supabase_user_id: "user-1" } } },
    });

    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(200);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("does not update anything when checkout metadata has an invalid plan value", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_2b",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_2b",
          metadata: { supabase_user_id: "user-1", plan: "enterprise" },
        },
      },
    });

    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(200);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("downgrades to free on customer.subscription.deleted", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_3",
      type: "customer.subscription.deleted",
      data: { object: { customer: "cus_1" } },
    });

    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({ tier: "free" });
    expect(updateEqMock).toHaveBeenCalledWith("stripe_customer_id", "cus_1");
  });

  it("keeps the current tier on customer.subscription.updated when cancellation is scheduled", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_4",
      type: "customer.subscription.updated",
      data: {
        object: {
          customer: "cus_1",
          cancel_at_period_end: true,
          items: { data: [{ price: { id: PRICE_IDS.pro_monthly } }] },
        },
      },
    });

    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(200);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updates the tier on customer.subscription.updated for an active plan change", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_5",
      type: "customer.subscription.updated",
      data: {
        object: {
          customer: "cus_1",
          cancel_at_period_end: false,
          items: { data: [{ price: { id: PRICE_IDS.premium_yearly } }] },
        },
      },
    });

    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({ tier: "premium" });
  });

  it("never downgrades a Pro subscriber to Premium on invoice.payment_succeeded renewal", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_6",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          customer: "cus_1",
          subscription: "sub_1",
        },
      },
    });
    subscriptionsRetrieveMock.mockResolvedValue({
      items: { data: [{ price: { id: PRICE_IDS.pro_monthly } }] },
    });

    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({ tier: "pro" });
  });

  it("reads the subscription id from the nested parent shape when top-level is absent", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_7",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          customer: "cus_1",
          parent: { subscription_details: { subscription: "sub_2" } },
        },
      },
    });
    subscriptionsRetrieveMock.mockResolvedValue({
      items: { data: [{ price: { id: PRICE_IDS.pro_monthly } }] },
    });

    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(200);
    expect(subscriptionsRetrieveMock).toHaveBeenCalledWith("sub_2");
  });

  it("does nothing for a one-off invoice with no subscription reference", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_8",
      type: "invoice.payment_succeeded",
      data: { object: { customer: "cus_1" } },
    });

    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(200);
    expect(subscriptionsRetrieveMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 200 without side effects for an unhandled event type", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_9",
      type: "some.unhandled.event",
      data: { object: {} },
    });

    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(200);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 500 if applying the checkout upgrade fails at the database", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_10",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_10",
          metadata: { supabase_user_id: "user-1", plan: "pro" },
        },
      },
    });
    updateEqMock.mockResolvedValue({ error: { message: "db down" } });

    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(500);
  });
});
