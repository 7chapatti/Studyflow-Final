import { describe, it, expect } from "vitest";
import { effectOfSubscriptionStatus, isOccupyingSubscriptionStatus } from "./subscription-status";

describe("effectOfSubscriptionStatus", () => {
  it("grants access only for paid-up statuses", () => {
    expect(effectOfSubscriptionStatus("active")).toBe("grant");
    expect(effectOfSubscriptionStatus("trialing")).toBe("grant");
  });

  it("revokes access once a subscription is over", () => {
    for (const status of ["canceled", "unpaid", "incomplete_expired", "paused"]) {
      expect(effectOfSubscriptionStatus(status)).toBe("revoke");
    }
  });

  it("leaves the tier alone while payment is unresolved", () => {
    expect(effectOfSubscriptionStatus("past_due")).toBe("ignore");
    expect(effectOfSubscriptionStatus("incomplete")).toBe("ignore");
  });

  it("ignores missing or unrecognised statuses rather than granting", () => {
    expect(effectOfSubscriptionStatus(undefined)).toBe("ignore");
    expect(effectOfSubscriptionStatus(null)).toBe("ignore");
    expect(effectOfSubscriptionStatus("something_new")).toBe("ignore");
  });
});

describe("isOccupyingSubscriptionStatus", () => {
  it("is true for subscriptions Stripe is billing or still trying to bill", () => {
    for (const status of ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]) {
      expect(isOccupyingSubscriptionStatus(status)).toBe(true);
    }
  });

  it("is false for finished subscriptions and missing statuses", () => {
    expect(isOccupyingSubscriptionStatus("canceled")).toBe(false);
    expect(isOccupyingSubscriptionStatus("incomplete_expired")).toBe(false);
    expect(isOccupyingSubscriptionStatus(undefined)).toBe(false);
  });
});
