// src/lib/api.ts
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Profile, ScheduledBlock } from "@/types";
import { TIER_LIMITS } from "@/types";
import { detectMissedBlocks } from "@/lib/scheduler";
import { logger } from "@/lib/logger";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function err(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function requireAuth() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { user: null, profile: null, error: err("Unauthorised", 401) };
  }

  const serviceSupabase = createServiceClient();
  const { data: profile, error: profileError } = await serviceSupabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    logger.error("Profile fetch error", { detail: profileError });
    return { user: null, profile: null, error: err("Profile not found", 404) };
  }

  return {
    user: { id: user.id, email: user.email as string },
    profile: profile as Profile,
    error: null,
  };
}

function tierLimits(tier: string) {
  return TIER_LIMITS[tier as keyof typeof TIER_LIMITS] ?? TIER_LIMITS.free;
}

// Fast pre-flight check for UI feedback. Not the enforcement point — that's
// create_assignment_atomic() in Postgres, which re-checks under an advisory
// lock so two concurrent requests can't both slip past the limit.
export async function checkAssignmentLimit(userId: string, tier: string) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active");
  const current = count ?? 0;
  const limit = tierLimits(tier).activeAssignments;
  return { allowed: current < limit, current, limit };
}

// Finds this user's scheduled_blocks that are now in the past, still tied
// to a task that's still "todo", and not already flagged -- and flags
// them. Pure detection (detectMissedBlocks(), scheduler.ts) is what
// decides which blocks qualify; this is just the DB read/write around it.
//
// Deliberately split from actually *rescheduling* the affected tasks: this
// alone is called on every dashboard load (see dashboard/page.tsx) as
// cheap, idempotent bookkeeping, so a missed block gets correctly flagged
// -- fixing what would otherwise be a silent gap in the peak-hours
// learning signal, since an unflagged past block reads as "held" -- the
// moment the user opens the app, not only after they click "Organise".
// /api/schedule/run calls this too, right before it does the real
// rescheduling work, so anything missed since the last dashboard load
// still gets picked up there.
export async function flagMissedBlocks(userId: string): Promise<ScheduledBlock[]> {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const { data: pastBlocksRaw, error } = await supabase
    .from("scheduled_blocks")
    .select("*, task:tasks(status)")
    .eq("user_id", userId)
    .eq("is_missed", false)
    .lt("end_time", nowIso);

  if (error) {
    logger.error("Missed-block fetch error", { detail: error });
    return [];
  }
  if (!pastBlocksRaw || pastBlocksRaw.length === 0) return [];

  const missed = detectMissedBlocks(pastBlocksRaw as ScheduledBlock[], new Date());
  if (missed.length === 0) return [];

  const { error: updateError } = await supabase
    .from("scheduled_blocks")
    .update({ is_missed: true })
    .in("id", missed.map((b) => b.id));

  if (updateError) {
    logger.error("Failed to flag missed blocks", { detail: updateError });
    return [];
  }

  return missed;
}

// Atomically reserves one AI analysis against the user's monthly quota via
// the consume_ai_analysis() RPC (row-locked, so concurrent requests can't
// both pass the check before either increment lands). The RPC derives both
// the user (auth.uid()) and the tier limit server-side -- neither can be
// supplied by the caller, so this can't be used to grant an arbitrary quota.
// Call this BEFORE doing the expensive OpenAI work, and call
// refundAIQuota(reservationId) with the id it returns if the request fails
// afterwards, so the user isn't charged quota for an analysis they never
// got. `profile` is kept as a parameter for the caller's own display/UX
// logic, but it is no longer sent to the database.
export async function consumeAIQuota(profile: Profile) {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("consume_ai_analysis").single();

  if (error) {
    logger.error("AI quota consume error", { detail: error });
    throw error;
  }

  const result = data as {
    allowed: boolean;
    used: number;
    limit: number;
    reservation_id: string | null;
  };

  // Fall back to the client-known tier limit only for display purposes if
  // the RPC ever returns 0 (e.g. profile lookup race) -- enforcement always
  // happened server-side regardless of this value.
  const limit = result.limit || tierLimits(profile.tier).aiAnalysesPerMonth;

  return {
    allowed: result.allowed,
    used: result.used,
    limit,
    reservationId: result.reservation_id,
  };
}

// Undoes one specific reservation returned by consumeAIQuota(). Each
// reservation can be refunded at most once and only by the user who created
// it (enforced inside the RPC), so this can't be looped to manufacture free
// quota the way a plain "decrement my own usage" call could.
export async function refundAIQuota(reservationId: string | null) {
  if (!reservationId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("refund_ai_analysis", {
    p_reservation_id: reservationId,
  });
  if (error) {
    logger.error("AI quota refund error", { detail: error });
  }
}
