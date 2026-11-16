// What a Stripe subscription's status means for plan access.
//
// The webhook used to set a user's tier from the subscription's price alone
// and never looked at its status. That let a subscription that had never
// been paid for, or had stopped being paid for, keep (or even gain) a paid
// tier: switching to a dearer plan with a card that then fails still fires
// customer.subscription.updated with the new price on it.
//
//   grant   paid up: give the tier for the price on the subscription.
//   revoke  over: drop to free unless another subscription is still good.
//   ignore  in limbo (Stripe is still retrying, or the first payment hasn't
//           gone through yet): leave the tier exactly as it is.
export type SubscriptionEffect = "grant" | "revoke" | "ignore";

const GRANTING = new Set(["active", "trialing"]);
const REVOKING = new Set(["canceled", "unpaid", "incomplete_expired", "paused"]);

export function effectOfSubscriptionStatus(status: string | null | undefined): SubscriptionEffect {
  if (!status) return "ignore";
  if (GRANTING.has(status)) return "grant";
  if (REVOKING.has(status)) return "revoke";
  return "ignore";
}

// Statuses where the customer already has a subscription that Stripe is
// billing or still trying to bill. Starting a second checkout on top of one
// of these would create a second, parallel subscription.
const OCCUPYING = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

export function isOccupyingSubscriptionStatus(status: string | null | undefined): boolean {
  return !!status && OCCUPYING.has(status);
}
