import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { removeCalendarConnection } from "@/lib/google/sync";

export const runtime = "nodejs";

// Revokes Duecourse's access with Google and deletes the stored token.
// Events already in the user's Google Calendar are left where they are.
export async function POST() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    await removeCalendarConnection(auth.user.id, { revoke: true });
    return NextResponse.json({ success: true, data: { connected: false } });
  } catch {
    return NextResponse.json(
      { success: false, error: "Couldn't disconnect Google Calendar. Please try again." },
      { status: 500 }
    );
  }
}
