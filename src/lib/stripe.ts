import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const PLANS = {
  premium_monthly: {
    name: "Premium",
    priceId: process.env.STRIPE_PREMIUM_PRICE_ID!,
    tier: "premium" as const,
    amount: 499,
    interval: "month" as const,
    currency: "gbp",
  },
  premium_yearly: {
    name: "Premium",
    priceId: process.env.STRIPE_PREMIUM_YEARLY_PRICE_ID!,
    tier: "premium" as const,
    amount: 4799,
    interval: "year" as const,
    currency: "gbp",
  },
  pro_monthly: {
    name: "Pro",
    priceId: process.env.STRIPE_PRO_PRICE_ID!,
    tier: "pro" as const,
    amount: 999,
    interval: "month" as const,
    currency: "gbp",
  },
  pro_yearly: {
    name: "Pro",
    priceId: process.env.STRIPE_PRO_YEARLY_PRICE_ID!,
    tier: "pro" as const,
    amount: 9599,
    interval: "year" as const,
    currency: "gbp",
  },
} as const;

export type PlanKey = keyof typeof PLANS;