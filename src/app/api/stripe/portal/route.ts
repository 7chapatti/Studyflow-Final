import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { requireAuth } from "@/lib/api";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { user, profile } = auth;
  const ip = getClientIp(request);
  const withinRateLimit = await checkRateLimit(`stripe-portal:${ip}`, 10, 10 * 60);
  if (!withinRateLimit) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  if (!profile.stripe_customer_id) {
    return NextResponse.json(
      { success: false, error: "No billing account found. Upgrade a plan first." },
      { status: 400 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${appUrl}/settings`,
    });

    return NextResponse.json({ success: true, data: { url: session.url } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Stripe portal error", { detail: message, userId: user.id });
    return NextResponse.json(
      { success: false, error: "Failed to open billing portal. Please try again." },
      { status: 500 }
    );
  }
}
