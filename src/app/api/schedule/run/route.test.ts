// src/app/api/schedule/run/route.ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { scheduleTasks } from "@/lib/scheduler";
import { calculatePaceRatio } from "@/lib/pace";
import type { Task, Assignment, BlockedTime, ScheduledBlock } from "@/types";

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { user } = auth;

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
    console.error("Tasks fetch error:", tasksError);
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
    console.error("Blocked times fetch error:", blockedTimesError);
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
    console.error("Scheduled blocks fetch error:", existingBlocksError);
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
    console.error("Pace log fetch error:", paceLogError);
    return NextResponse.json(
      { success: false, error: "Failed to fetch pace history." },
      { status: 500 }
    );
  }

  const paceRatio = calculatePaceRatio(paceLogRaw ?? []);

  const nowIso = new Date().toISOString();
  const taskIdsToReschedule = tasks.map((t) => t.id);

  const blocksToReplace = (existingBlocksRaw ?? []).filter(
    (block) =>
      taskIdsToReschedule.includes(block.task_id) &&
      new Date(block.start_time) >= new Date(nowIso)
  ) as ScheduledBlock[];

  if (blocksToReplace.length > 0) {
    const { error: deleteError } = await supabase
      .from("scheduled_blocks")
      .delete()
      .in("id", blocksToReplace.map((b) => b.id));

    if (deleteError) {
      console.error("Block delete error:", deleteError);
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
    console.error("Scheduled blocks refetch error:", refreshedBlocksError);
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
      console.error("Block insert error:", insertError);

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
          console.error("Failed to restore original blocks:", restoreError);
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
