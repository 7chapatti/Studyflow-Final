import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { scheduleTasks, FATIGUE_WEIGHTS, blockOverlapsBlockedTimes } from "@/lib/scheduler";
import { calculatePaceRatio } from "@/lib/pace";
import { buildPersonalHourWeights, type HourObservation } from "@/lib/peak-hours";
import { toZonedTime } from "date-fns-tz";
import type { Task, Assignment, BlockedTime, ScheduledBlock } from "@/types";
import { logger } from "@/lib/logger";

const PEAK_HOURS_LOOKBACK_DAYS = 120;
const PEAK_HOURS_MAX_BLOCKS = 300;

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { user, profile } = auth;

  let assignmentId: string | null = null;
  try {
    const body = await request.json();
    assignmentId = body.assignmentId ?? null;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request." },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  if (assignmentId) {
    const { data: ownerCheck, error: ownerCheckError } = await supabase
      .from("assignments")
      .select("id")
      .eq("id", assignmentId)
      .eq("user_id", user.id)
      .single();

    if (ownerCheckError || !ownerCheck) {
      return NextResponse.json(
        { success: false, error: "Assignment not found." },
        { status: 404 }
      );
    }
  }

  let tasksQuery = supabase
    .from("tasks")
    .select("*, assignment:assignments!inner(*)")
    .eq("assignments.user_id", user.id)
    .eq("assignments.status", "active")
    .neq("status", "done");

  if (assignmentId) {
    tasksQuery = tasksQuery.eq("assignment_id", assignmentId);
  }

  const { data: tasksRaw, error: tasksError } = await tasksQuery;

  if (tasksError) {
    logger.error("Tasks fetch error", { detail: tasksError });
    return NextResponse.json(
      { success: false, error: "Failed to fetch tasks." },
      { status: 500 }
    );
  }

  const tasks = (tasksRaw ?? []) as Array<Task & { assignment: Assignment }>;

  const { data: blockedTimesRaw, error: blockedTimesError } = await supabase
    .from("blocked_times")
    .select("*")
    .eq("user_id", user.id);

  if (blockedTimesError) {
    logger.error("Blocked times fetch error", { detail: blockedTimesError });
    return NextResponse.json(
      { success: false, error: "Failed to fetch blocked times." },
      { status: 500 }
    );
  }

  const { data: existingBlocksRaw, error: existingBlocksError } = await supabase
    .from("scheduled_blocks")
    .select("*, task:tasks(status)")
    .eq("user_id", user.id)
    .gte("end_time", new Date().toISOString());

  if (existingBlocksError) {
    logger.error("Scheduled blocks fetch error", { detail: existingBlocksError });
    return NextResponse.json(
      { success: false, error: "Failed to fetch existing schedule." },
      { status: 500 }
    );
  }

  const { data: paceLogRaw, error: paceLogError } = await supabase
    .from("pace_log")
    .select("*")
    .eq("user_id", user.id)
    .order("logged_at", { ascending: false })
    .limit(20);

  if (paceLogError) {
    logger.error("Pace log fetch error", { detail: paceLogError });
    return NextResponse.json(
      { success: false, error: "Failed to fetch pace history." },
      { status: 500 }
    );
  }

  const paceRatio = calculatePaceRatio(paceLogRaw ?? []);
  const lookbackCutoff = new Date(
    Date.now() - PEAK_HOURS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: pastBlocksRaw, error: pastBlocksError } = await supabase
    .from("scheduled_blocks")
    .select("start_time, is_missed")
    .eq("user_id", user.id)
    .lt("end_time", new Date().toISOString())
    .gte("start_time", lookbackCutoff)
    .order("start_time", { ascending: false })
    .limit(PEAK_HOURS_MAX_BLOCKS);

  if (pastBlocksError) {
    logger.error("Past blocks fetch error (peak-hours)", { detail: pastBlocksError });
  }

  const hourObservations: HourObservation[] = (pastBlocksRaw ?? []).map((b) => ({
    hour: toZonedTime(new Date(b.start_time), profile.timezone).getHours(),
    success: !b.is_missed,
  }));

  const personalHourWeights = buildPersonalHourWeights(hourObservations, FATIGUE_WEIGHTS);

  const nowIso = new Date().toISOString();
  const taskIdsToReschedule = tasks.map((t) => t.id);

  const candidateBlocks = (existingBlocksRaw ?? []).filter(
    (block) =>
      taskIdsToReschedule.includes(block.task_id) &&
      new Date(block.start_time) >= new Date(nowIso)
  ) as ScheduledBlock[];
  
  const blockedTimesForValidityCheck = (blockedTimesRaw ?? []) as BlockedTime[];

  const blocksToReplace = candidateBlocks.filter((block) =>
    blockOverlapsBlockedTimes(block, blockedTimesForValidityCheck, profile.timezone)
  );
  const validBlocks = candidateBlocks.filter(
    (block) => !blockOverlapsBlockedTimes(block, blockedTimesForValidityCheck, profile.timezone)
  );

  const alreadyScheduledHours: Record<string, number> = {};
  for (const block of validBlocks) {
    const hours =
      (new Date(block.end_time).getTime() - new Date(block.start_time).getTime()) / 3_600_000;
    alreadyScheduledHours[block.task_id] = (alreadyScheduledHours[block.task_id] ?? 0) + hours;
  }

  if (blocksToReplace.length > 0) {
    const { error: deleteError } = await supabase
      .from("scheduled_blocks")
      .delete()
      .in("id", blocksToReplace.map((b) => b.id));

    if (deleteError) {
      logger.error("Block delete error", { detail: deleteError });
      return NextResponse.json(
        { success: false, error: "Failed to clear old schedule." },
        { status: 500 }
      );
    }
  }

  const { data: refreshedBlocksRaw, error: refreshedBlocksError } = await supabase
    .from("scheduled_blocks")
    .select("*, task:tasks(status)")
    .eq("user_id", user.id)
    .gte("end_time", new Date().toISOString());

  if (refreshedBlocksError) {
    logger.error("Scheduled blocks refetch error", { detail: refreshedBlocksError });
    return NextResponse.json(
      { success: false, error: "Failed to refresh existing schedule." },
      { status: 500 }
    );
  }

  if (tasks.length === 0) {
    return NextResponse.json({
      success: true,
      data: { blocks: 0, atRisk: [] },
    });
  }

  const { blocks, panicTaskIds, atRisk } = scheduleTasks(user.id, {
    tasks,
    blockedTimes: (blockedTimesRaw ?? []) as BlockedTime[],
    existingBlocks: (refreshedBlocksRaw ?? []) as ScheduledBlock[],
    paceRatio,

    timezone: profile.timezone,
    personalHourWeights,
    alreadyScheduledHours,
  });

  if (blocks.length > 0) {
    const blocksWithPanic = blocks.map((b) => ({
      ...b,
      is_panic: panicTaskIds.includes(b.task_id),
    }));

    const { error: insertError } = await supabase
      .from("scheduled_blocks")
      .insert(blocksWithPanic);

    if (insertError) {
      logger.error("Block insert error", { detail: insertError });

      if (blocksToReplace.length > 0) {
        const restoreBlocks = blocksToReplace.map((b) => ({
          id: b.id,
          user_id: b.user_id,
          task_id: b.task_id,
          start_time: b.start_time,
          end_time: b.end_time,
          google_event_id: b.google_event_id,
          is_missed: b.is_missed,
          created_at: b.created_at,
        }));

        const { error: restoreError } = await supabase
          .from("scheduled_blocks")
          .insert(restoreBlocks);

        if (restoreError) {
          logger.error("Failed to restore original blocks", { detail: restoreError });
        }
      }

      return NextResponse.json(
        { success: false, error: "Failed to save schedule." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      blocks: blocks.length,
      atRisk: atRisk.map((r) => ({
        taskName: r.task.name,
        assignmentName: r.assignment.name,
        hoursNeeded: r.hoursNeeded,
        hoursAvailable: r.hoursAvailable,
      })),
    },
  });
}
