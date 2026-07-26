// src/app/api/stripe/webhook/route.ts
import { NextResponse } from "next/server";
import { stripe, PLANS } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type PlanTier = "premium" | "pro";

const PRICE_TO_TIER: Record<string, PlanTier> = {
  [PLANS.premium_monthly.priceId]: "premium",
  [PLANS.premium_yearly.priceId]: "premium",
  [PLANS.pro_monthly.priceId]: "pro",
  [PLANS.pro_yearly.priceId]: "pro",
};

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
    console.error("Webhook signature verification failed:", message);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Idempotency: insert the Stripe event id once, and bail out on duplicates.
  const { error: logError } = await supabase
    .from("stripe_webhook_events")
    .insert({ id: event.id, event_type: event.type });

  if (logError) {
    // Postgres unique violation on duplicate event delivery.
    if (logError.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }

    console.error("Failed to log Stripe event:", logError);
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
          console.error("Missing or invalid metadata in checkout session:", session.id);
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
          console.error("Failed to apply checkout upgrade:", error);
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
          console.error("Failed to downgrade cancelled subscription:", error);
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

        // If cancellation is scheduled, keep the current tier until deleted/cycle end.
        if (subscription.cancel_at_period_end) break;

        const priceId = subscription.items.data.find((item) => PRICE_TO_TIER[item.price.id])
          ?.price.id;

        const newTier = priceId ? PRICE_TO_TIER[priceId] : null;
        if (!newTier) break;

        const { error } = await supabase
          .from("profiles")
          .update({ tier: newTier })
          .eq("stripe_customer_id", subscription.customer);

        if (error) {
          console.error("Failed to update subscription tier:", error);
          return NextResponse.json(
            { error: "Failed to update plan." },
            { status: 500 }
          );
        }

        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as { customer: string };
        console.warn(`Payment failed for customer ${invoice.customer}`);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as {
          customer: string;
          subscription?: string | null;
        };

        const { error } = await supabase
          .from("profiles")
          .update({ tier: "premium" })
          .eq("stripe_customer_id", invoice.customer)
          .in("tier", ["free", "premium", "pro"]);

        if (error) {
          console.error("Failed to sync renewal payment:", error);
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
    console.error("Webhook handler error:", message);
    return NextResponse.json(
      { error: "Webhook handler failed." },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
