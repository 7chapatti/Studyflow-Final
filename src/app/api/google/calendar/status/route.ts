import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase/server";
import { isGoogleCalendarConfigured } from "@/lib/google/oauth";
import { tierIncludesCalendarSync } from "@/lib/google/sync";

export const runtime = "nodejs";

// What the settings page needs to draw the Google Calendar section. Only
// ever returns whether a connection exists and when it last synced, never
// anything about the stored token.
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { user, profile } = auth;

  const configured = isGoogleCalendarConfigured();
  let connected = false;
  let lastSyncedAt: string | null = null;

  if (configured) {
    const { data } = await createServiceClient()
      .from("google_calendar_connections")
      .select("last_synced_at")
      .eq("user_id", user.id)
      .maybeSingle();

    connected = Boolean(data);
    lastSyncedAt = data?.last_synced_at ?? null;
  }

  return NextResponse.json({
    success: true,
    data: {
      configured,
      eligible: tierIncludesCalendarSync(profile.tier),
      connected,
      lastSyncedAt,
    },
  });
}
