import { NextResponse } from "next/server";
import { stripe, PLANS, type PlanKey } from "@/lib/stripe";
import { requireAuth } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { isOccupyingSubscriptionStatus } from "@/lib/subscription-status";

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { user, profile } = auth;
  const ip = getClientIp(request);
  const withinRateLimit = await checkRateLimit(`stripe-checkout:${ip}`, 10, 10 * 60);
  if (!withinRateLimit) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  let plan: PlanKey;
  try {
    const body = await request.json();
    plan = body.plan as PlanKey;
    if (!plan || !PLANS[plan]) {
      return NextResponse.json(
        { success: false, error: "Invalid plan." },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request." },
      { status: 400 }
    );
  }

  const selectedPlan = PLANS[plan];

  if (profile.tier === selectedPlan.tier) {
    return NextResponse.json(
      { success: false, error: "You are already on this plan." },
      { status: 400 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    const supabase = createServiceClient();
    const { data: profileData } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    let customerId: string | undefined =
      profileData?.stripe_customer_id ?? undefined;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    } else {
      // Someone who already has a subscription (e.g. Premium, now clicking
      // "Upgrade to Pro") must change that subscription, not buy a second
      // one alongside it. A fresh checkout here would leave them billed
      // for both plans at once. Send them to Stripe's billing portal,
      // which swaps the plan on the existing subscription and prorates it.
      const existing = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 20,
      });
      const current = existing.data.find((sub) => isOccupyingSubscriptionStatus(sub.status));

      if (current) {
        const returnUrl = `${appUrl}/upgrade`;
        let portalUrl: string;
        try {
          // Deep-links straight to the "change plan" screen. Only works if
          // plan switching is enabled in the Stripe portal settings.
          const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl,
            flow_data: {
              type: "subscription_update",
              subscription_update: { subscription: current.id },
            },
          });
          portalUrl = session.url;
        } catch {
          try {
            const session = await stripe.billingPortal.sessions.create({
              customer: customerId,
              return_url: returnUrl,
            });
            portalUrl = session.url;
          } catch (portalErr: unknown) {
            // The billing portal hasn't been set up in Stripe yet. Say so
            // plainly rather than falling through to a second subscription
            // or a generic failure.
            logger.error("Stripe billing portal unavailable for plan change", {
              detail: portalErr instanceof Error ? portalErr.message : "Unknown error",
              userId: user.id,
            });
            return NextResponse.json(
              {
                success: false,
                error:
                  "You already have a subscription, and switching plans isn't available just yet. Please get in touch and we'll change it for you.",
              },
              { status: 409 }
            );
          }
        }

        return NextResponse.json({ success: true, data: { url: portalUrl, portal: true } });
      }
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: selectedPlan.priceId, quantity: 1 }],
      success_url: `${appUrl}/upgrade?upgraded=true`,
      cancel_url: `${appUrl}/upgrade?cancelled=true`,
      metadata: {
        supabase_user_id: user.id,
        plan: selectedPlan.tier,
      },
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
          plan: selectedPlan.tier,
        },
      },
    });

    return NextResponse.json({ success: true, data: { url: session.url } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Stripe checkout error", { detail: message });
    return NextResponse.json(
      { success: false, error: "Failed to create checkout session." },
      { status: 500 }
    );
  }
}
