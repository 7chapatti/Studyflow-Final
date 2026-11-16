import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  buildCalendarAuthUrl,
  isGoogleCalendarConfigured,
  CALENDAR_STATE_COOKIE,
  CALENDAR_STATE_COOKIE_PATH,
  CALENDAR_STATE_MAX_AGE_SECONDS,
} from "@/lib/google/oauth";
import { tierIncludesCalendarSync } from "@/lib/google/sync";

export const runtime = "nodejs";

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

// Starts the "Connect Google Calendar" flow: sends the browser to Google's
// consent screen. A plain link navigates here, so every outcome is a
// redirect rather than JSON.
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) {
    return NextResponse.redirect(`${appUrl()}/login?redirectTo=${encodeURIComponent("/settings")}`);
  }
  const { user, profile } = auth;

  if (!isGoogleCalendarConfigured()) {
    return NextResponse.redirect(`${appUrl()}/settings?calendar=unavailable`);
  }
  if (!tierIncludesCalendarSync(profile.tier)) {
    return NextResponse.redirect(`${appUrl()}/upgrade`);
  }

  const withinRateLimit = await checkRateLimit(`gcal-connect:user:${user.id}`, 10, 10 * 60);
  if (!withinRateLimit) {
    return NextResponse.redirect(`${appUrl()}/settings?calendar=slow_down`);
  }

  // `state` ties Google's reply to this browser. Without it, someone could
  // complete the Google step with their own account and trick a logged-in
  // user into finishing it, which would send that user's study plan to the
  // attacker's calendar. The callback only accepts a reply whose state
  // matches the value in this cookie.
  const state = randomBytes(32).toString("hex");

  const response = NextResponse.redirect(buildCalendarAuthUrl(state));
  response.cookies.set(CALENDAR_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: CALENDAR_STATE_COOKIE_PATH,
    maxAge: CALENDAR_STATE_MAX_AGE_SECONDS,
  });
  return response;
}
