import { NextResponse } from "next/server";
import { stripe, PLANS } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

type PlanTier = "premium" | "pro";

const PRICE_TO_TIER: Record<string, PlanTier> = {
  [PLANS.premium_monthly.priceId]: "premium",
  [PLANS.premium_yearly.priceId]: "premium",
  [PLANS.pro_monthly.priceId]: "pro",
  [PLANS.pro_yearly.priceId]: "pro",
};

function resolveTierFromSubscription(subscription: {
  items: { data: { price: { id: string } }[] };
}): PlanTier | null {
  const priceId = subscription.items.data.find((item) => PRICE_TO_TIER[item.price.id])?.price.id;
  return priceId ? PRICE_TO_TIER[priceId] : null;
}

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header." },
      { status: 400 }
    );
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Webhook signature verification failed", { detail: message });
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error: logError } = await supabase
    .from("stripe_webhook_events")
    .insert({ id: event.id, event_type: event.type });

  if (logError) {
    if (logError.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }

    logger.error("Failed to log Stripe event", { detail: logError });
    return NextResponse.json(
      { error: "Failed to record event." },
      { status: 500 }
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as {
          id: string;
          customer?: string | null;
          metadata?: { supabase_user_id?: string; plan?: string };
        };

        const userId = session.metadata?.supabase_user_id;
        const plan = session.metadata?.plan;

        if (!userId || !plan || !(plan === "premium" || plan === "pro")) {
          logger.error("Missing or invalid metadata in checkout session", { detail: session.id });
          break;
        }

        const { error } = await supabase
          .from("profiles")
          .update({
            tier: plan,
            stripe_customer_id: session.customer ?? null,
          })
          .eq("id", userId);

        if (error) {
          logger.error("Failed to apply checkout upgrade", { detail: error });
          return NextResponse.json(
            { error: "Failed to apply upgrade." },
            { status: 500 }
          );
        }

        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as { customer: string };

        const { error } = await supabase
          .from("profiles")
          .update({ tier: "free" })
          .eq("stripe_customer_id", subscription.customer);

        if (error) {
          logger.error("Failed to downgrade cancelled subscription", { detail: error });
          return NextResponse.json(
            { error: "Failed to apply cancellation." },
            { status: 500 }
          );
        }

        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as {
          customer: string;
          cancel_at_period_end?: boolean;
          items: { data: { price: { id: string } }[] };
        };
        if (subscription.cancel_at_period_end) break;

        const newTier = resolveTierFromSubscription(subscription);
        if (!newTier) break;

        const { error } = await supabase
          .from("profiles")
          .update({ tier: newTier })
          .eq("stripe_customer_id", subscription.customer);

        if (error) {
          logger.error("Failed to update subscription tier", { detail: error });
          return NextResponse.json(
            { error: "Failed to update plan." },
            { status: 500 }
          );
        }

        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as { customer: string };
        logger.warn(`Payment failed for customer ${invoice.customer}`);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as {
          customer: string;
          subscription?: string | { id: string } | null;
          parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
        };

        const rawSubscriptionRef =
          invoice.subscription ?? invoice.parent?.subscription_details?.subscription ?? null;

        const subscriptionId =
          typeof rawSubscriptionRef === "string" ? rawSubscriptionRef : rawSubscriptionRef?.id;

        if (!subscriptionId) {
          break;
        }

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const newTier = resolveTierFromSubscription(subscription);

        if (!newTier) {
          logger.error("Could not resolve tier for renewed subscription", { detail: subscriptionId });
          break;
        }

        const { error } = await supabase
          .from("profiles")
          .update({ tier: newTier })
          .eq("stripe_customer_id", invoice.customer);

        if (error) {
          logger.error("Failed to sync renewal payment", { detail: error });
          return NextResponse.json(
            { error: "Failed to apply renewal." },
            { status: 500 }
          );
        }

        break;
      }

      default:
        break;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Webhook handler error", { detail: message });
    return NextResponse.json(
      { error: "Webhook handler failed." },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
