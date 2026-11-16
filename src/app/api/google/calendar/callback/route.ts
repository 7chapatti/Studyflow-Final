import { timingSafeEqual } from "node:crypto";
import { NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import {
  exchangeCodeForTokens,
  isGoogleCalendarConfigured,
  CALENDAR_STATE_COOKIE,
  CALENDAR_STATE_COOKIE_PATH,
} from "@/lib/google/oauth";
import { encryptToken } from "@/lib/google/token-crypto";
import { syncUserCalendar, tierIncludesCalendarSync } from "@/lib/google/sync";

export const runtime = "nodejs";

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

function statesMatch(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

function backToSettings(outcome: string) {
  const response = NextResponse.redirect(`${appUrl()}/settings?calendar=${outcome}`);
  // Single use: whatever happened, this state value is finished with.
  response.cookies.set(CALENDAR_STATE_COOKIE, "", { path: CALENDAR_STATE_COOKIE_PATH, maxAge: 0 });
  return response;
}

// Google sends the browser back here after the consent screen.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(CALENDAR_STATE_COOKIE)?.value;

  // Checked before anything else, including Google's own error parameter,
  // so a forged link to this URL can't do or reveal anything.
  if (!statesMatch(expectedState, state)) {
    return backToSettings("error");
  }

  if (searchParams.get("error") || !code) {
    return backToSettings("declined");
  }

  const auth = await requireAuth();
  if (auth.error) {
    return NextResponse.redirect(`${appUrl()}/login?redirectTo=${encodeURIComponent("/settings")}`);
  }
  const { user, profile } = auth;

  if (!isGoogleCalendarConfigured() || !tierIncludesCalendarSync(profile.tier)) {
    return backToSettings("error");
  }

  try {
    const { refreshToken } = await exchangeCodeForTokens(code);
    const supabase = createServiceClient();

    // Only the token columns are named, so reconnecting keeps the existing
    // calendar_id and events carry on landing in the same calendar.
    const { error: upsertError } = await supabase.from("google_calendar_connections").upsert(
      {
        user_id: user.id,
        refresh_token_encrypted: encryptToken(refreshToken),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
    if (upsertError) throw upsertError;

    await supabase.from("profiles").update({ google_calendar_connected: true }).eq("id", user.id);

    // First sync runs after the redirect has been sent, so connecting
    // feels instant even with a full calendar to push.
    after(async () => {
      await syncUserCalendar(user.id);
    });

    return backToSettings("connected");
  } catch (err) {
    logger.error("Google Calendar connect failed", {
      detail: err instanceof Error ? err.message : String(err),
      userId: user.id,
    });
    return backToSettings("error");
  }
}
