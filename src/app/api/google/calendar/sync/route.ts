import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { syncUserCalendar } from "@/lib/google/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

// The "Sync now" button in settings.
export async function POST() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { user } = auth;

  const withinRateLimit = await checkRateLimit(`gcal-sync:user:${user.id}`, 12, 10 * 60);
  if (!withinRateLimit) {
    return NextResponse.json(
      { success: false, error: "You've synced a lot in the last few minutes. Please wait a moment and try again." },
      { status: 429 }
    );
  }

  const result = await syncUserCalendar(user.id);

  switch (result.status) {
    case "synced":
      return NextResponse.json({ success: true, data: result });
    case "not_eligible":
      return NextResponse.json(
        { success: false, error: "Google Calendar sync is part of the Premium and Pro plans." },
        { status: 403 }
      );
    case "not_connected":
      return NextResponse.json(
        { success: false, error: "Google Calendar isn't connected." },
        { status: 409 }
      );
    case "disconnected":
      return NextResponse.json(
        {
          success: false,
          error: "Duecourse no longer has access to your Google Calendar. Please connect it again.",
          data: { disconnected: true },
        },
        { status: 409 }
      );
    case "not_configured":
      return NextResponse.json(
        { success: false, error: "Google Calendar sync isn't available right now." },
        { status: 503 }
      );
    default:
      return NextResponse.json(
        { success: false, error: "Couldn't sync with Google Calendar. Please try again." },
        { status: 502 }
      );
  }
}
