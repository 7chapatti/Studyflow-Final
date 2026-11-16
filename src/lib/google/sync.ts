// Pushes a user's upcoming study blocks to their "Duecourse" calendar in
// Google Calendar. One-way: Duecourse is the source of truth and Google is
// a mirror of it.
//
// Server-only. Uses the service-role client because the table holding the
// refresh token has no RLS policies at all (nothing in the browser can
// read it), so every query here is explicitly scoped to the one userId
// passed in, which callers take from the verified session.
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { decryptToken } from "./token-crypto";
import { GoogleAuthError, isGoogleCalendarConfigured, refreshAccessToken, revokeToken } from "./oauth";
import {
  calendarExists,
  createDuecourseCalendar,
  createEvent,
  deleteEvent,
  listUpcomingEvents,
  updateEvent,
} from "./calendar-api";
import { eventIdForBlock, planCalendarSync, type DesiredEvent } from "./sync-plan";

const SYNC_HORIZON_DAYS = 90;
const MAX_BLOCKS = 500;
const CONCURRENCY = 5;

// Google Calendar sync is a paid-plan feature (see the pricing table).
export function tierIncludesCalendarSync(tier: string): boolean {
  return tier === "premium" || tier === "pro";
}

export type CalendarSyncResult =
  | { status: "synced"; created: number; updated: number; removed: number; failed: number }
  | { status: "not_configured" | "not_connected" | "not_eligible" | "disconnected" | "failed" };

interface BlockRow {
  id: string;
  start_time: string;
  end_time: string;
  task: {
    name: string;
    status: string;
    assignment: { id: string; name: string } | null;
  } | null;
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

function toDesiredEvent(block: BlockRow): DesiredEvent | null {
  const task = block.task;
  // Finished tasks are hidden from the in-app calendar too.
  if (!task || task.status === "done") return null;

  const assignment = task.assignment;
  return {
    id: eventIdForBlock(block.id),
    summary: assignment ? `${task.name} · ${assignment.name}` : task.name,
    description: assignment
      ? `Study block planned by Duecourse.\n${appUrl()}/dashboard/assignment/${assignment.id}`
      : "Study block planned by Duecourse.",
    start: new Date(block.start_time).toISOString(),
    end: new Date(block.end_time).toISOString(),
  };
}

// Runs `worker` over `items` a few at a time and reports how many failed,
// so one bad event doesn't abandon the rest of the sync.
async function runAll<T>(items: T[], worker: (item: T) => Promise<void>): Promise<number> {
  let failed = 0;
  let next = 0;

  async function lane() {
    while (next < items.length) {
      const item = items[next++];
      try {
        await worker(item);
      } catch (err) {
        failed++;
        logger.warn("Google Calendar sync: one event failed", {
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, lane));
  return failed;
}

// Forgets the connection locally. Used when the user disconnects, deletes
// their account, or has revoked access from the Google side.
export async function removeCalendarConnection(
  userId: string,
  options: { revoke: boolean }
): Promise<void> {
  const supabase = createServiceClient();

  if (options.revoke) {
    const { data: connection } = await supabase
      .from("google_calendar_connections")
      .select("refresh_token_encrypted")
      .eq("user_id", userId)
      .maybeSingle();

    if (connection?.refresh_token_encrypted) {
      try {
        await revokeToken(decryptToken(connection.refresh_token_encrypted));
      } catch (err) {
        logger.warn("Could not revoke Google token", {
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const { error: deleteError } = await supabase
    .from("google_calendar_connections")
    .delete()
    .eq("user_id", userId);
  if (deleteError) {
    logger.error("Failed to delete Google Calendar connection", { detail: deleteError });
    throw new Error("Failed to remove calendar connection");
  }

  await supabase.from("profiles").update({ google_calendar_connected: false }).eq("id", userId);
}

export async function syncUserCalendar(userId: string): Promise<CalendarSyncResult> {
  if (!isGoogleCalendarConfigured()) return { status: "not_configured" };

  const supabase = createServiceClient();

  const [{ data: profile }, { data: connection }] = await Promise.all([
    supabase.from("profiles").select("tier, timezone").eq("id", userId).single(),
    supabase
      .from("google_calendar_connections")
      .select("refresh_token_encrypted, calendar_id")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (!connection) return { status: "not_connected" };
  if (!profile || !tierIncludesCalendarSync(profile.tier)) return { status: "not_eligible" };

  try {
    let accessToken: string;
    try {
      accessToken = await refreshAccessToken(decryptToken(connection.refresh_token_encrypted));
    } catch (err) {
      // The user removed Duecourse's access from their Google account.
      // Nothing to revoke; just stop claiming to be connected.
      if (err instanceof GoogleAuthError && err.code === "invalid_grant") {
        await removeCalendarConnection(userId, { revoke: false });
        return { status: "disconnected" };
      }
      throw err;
    }

    let calendarId = connection.calendar_id as string | null;
    if (!calendarId || !(await calendarExists(accessToken, calendarId))) {
      calendarId = await createDuecourseCalendar(accessToken, profile.timezone || "Europe/London");
      await supabase
        .from("google_calendar_connections")
        .update({ calendar_id: calendarId, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
    }

    const now = new Date();
    const horizon = new Date(now.getTime() + SYNC_HORIZON_DAYS * 24 * 3_600_000);

    const { data: blocksRaw, error: blocksError } = await supabase
      .from("scheduled_blocks")
      .select("id, start_time, end_time, task:tasks(name, status, assignment:assignments(id, name))")
      .eq("user_id", userId)
      .gt("end_time", now.toISOString())
      .lte("start_time", horizon.toISOString())
      .order("start_time")
      .limit(MAX_BLOCKS);

    if (blocksError) {
      logger.error("Google Calendar sync: failed to load blocks", { detail: blocksError });
      return { status: "failed" };
    }

    const desired = ((blocksRaw ?? []) as unknown as BlockRow[])
      .map(toDesiredEvent)
      .filter((event): event is DesiredEvent => event !== null);

    const existing = await listUpcomingEvents(accessToken, calendarId, now.toISOString());
    const plan = planCalendarSync(desired, existing);

    const token = accessToken;
    const target = calendarId;
    const failed =
      (await runAll(plan.create, (event) => createEvent(token, target, event))) +
      (await runAll(plan.update, (event) => updateEvent(token, target, event))) +
      (await runAll(plan.remove, (eventId) => deleteEvent(token, target, eventId)));

    await supabase
      .from("google_calendar_connections")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("user_id", userId);

    return {
      status: "synced",
      created: plan.create.length,
      updated: plan.update.length,
      removed: plan.remove.length,
      failed,
    };
  } catch (err) {
    logger.error("Google Calendar sync failed", {
      detail: err instanceof Error ? err.message : String(err),
      userId,
    });
    return { status: "failed" };
  }
}
