import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { logger } from "@/lib/logger";
import { removeCalendarConnection } from "@/lib/google/sync";
import { isGoogleCalendarConfigured } from "@/lib/google/oauth";

const STORAGE_BUCKET = "briefs";

export async function DELETE() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { user, profile } = auth;
  const supabase = createServiceClient();

  if (profile.stripe_customer_id) {
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: profile.stripe_customer_id,
        status: "all",
      });

      const stillBilling = subscriptions.data.filter((sub) =>
        ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(sub.status)
      );

      await Promise.all(stillBilling.map((sub) => stripe.subscriptions.cancel(sub.id)));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error("Failed to cancel Stripe subscription during account deletion", {
        detail: message,
        userId: user.id,
      });
      return NextResponse.json(
        {
          success: false,
          error:
            "Couldn't confirm your subscription was cancelled, so your account wasn't deleted. Please try again, or contact support if this keeps happening.",
        },
        { status: 500 }
      );
    }
  }

  // Withdraw Duecourse's access to the user's Google Calendar, if they ever
  // connected one. The stored token is removed with the account either way
  // (the row cascades), but deleting it here alone would leave the grant
  // itself alive on Google's side. Best-effort: a failure to reach Google
  // must not block someone from deleting their account.
  try {
    if (isGoogleCalendarConfigured()) {
      await removeCalendarConnection(user.id, { revoke: true });
    }
  } catch (err: unknown) {
    logger.warn("Could not remove Google Calendar connection during account deletion", {
      detail: err instanceof Error ? err.message : "Unknown error",
      userId: user.id,
    });
  }

  const { data: files } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list(user.id, { limit: 1000 });

  if (files?.length) {
    await supabase.storage
      .from(STORAGE_BUCKET)
      .remove(files.map((file: { name: string }) => `${user.id}/${file.name}`));
  }

  const { error: profileDeleteError } = await supabase
    .from("profiles")
    .delete()
    .eq("id", user.id);

  if (profileDeleteError) {
    logger.error("Profile delete failed", { detail: profileDeleteError });
    return NextResponse.json(
      { success: false, error: "Failed to delete account data." },
      { status: 500 }
    );
  }

  const { error: authDeleteError } = await supabase.auth.admin.deleteUser(user.id);
  if (authDeleteError) {
    logger.error("Auth delete failed", { detail: authDeleteError });
    return NextResponse.json(
      { success: false, error: "Failed to delete account." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    data: { deleted: true },
  });
}
