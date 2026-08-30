import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { CreateAssignmentWithPlanSchema } from "@/lib/validation";
import { logger } from "@/lib/logger";

// Creates an assignment together with its AI-derived tasks and checklist.
//
// This replaced a client-side flow that did a plain `count()` check followed
// by a separate `.insert()` — two fast requests (double-click, two tabs)
// could both pass the check and both insert, silently exceeding the active
// assignment limit. create_assignment_atomic() re-checks the limit under a
// Postgres advisory lock, so this route is now the single place that
// enforces it.
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = CreateAssignmentWithPlanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  const { name, description, deadline, priority, sections, checklist } = parsed.data;
  const supabase = await createClient();

  const estimatedHours =
    sections.length > 0
      ? Math.round(sections.reduce((sum, s) => sum + s.hours, 0) * 10) / 10
      : 0;

  // Colour is cosmetic only (which swatch an assignment gets in the UI), so
  // a random pick is fine here — no need for a count query just for that.
  const colourIndex = Math.floor(Math.random() * 6);

  // Note: the RPC derives the owner from the caller's auth session
  // (auth.uid()) server-side -- it no longer takes a p_user_id argument, so
  // there's no way to pass someone else's id here even if this route's
  // input handling changes later.
  const { data: assignmentId, error: rpcError } = await supabase.rpc("create_assignment_atomic", {
    p_name: name,
    p_description: description || null,
    p_deadline: deadline,
    p_priority: priority,
    p_estimated_hours: estimatedHours,
    p_colour_index: colourIndex,
  });

  if (rpcError) {
    if (rpcError.message?.includes("active_assignment_limit_reached")) {
      return NextResponse.json(
        {
          success: false,
          error:
            "You've reached your plan's active assignment limit. Archive a completed assignment to add more.",
        },
        { status: 409 }
      );
    }

    logger.error("create_assignment_atomic error", { detail: rpcError });
    return NextResponse.json(
      { success: false, error: "Failed to create assignment." },
      { status: 500 }
    );
  }

  if (!assignmentId) {
    return NextResponse.json(
      { success: false, error: "Failed to create assignment." },
      { status: 500 }
    );
  }

  // Best-effort compensation: if writing the plan fails after the
  // assignment was created, delete it rather than leaving an assignment
  // with no tasks silently sitting in the user's dashboard.
  async function rollbackAssignment() {
    const { error } = await supabase.from("assignments").delete().eq("id", assignmentId);
    if (error) {
      logger.error("Failed to roll back assignment after partial write", { detail: error });
    }
  }

  if (sections.length > 0) {
    const { error: tasksError } = await supabase.from("tasks").insert(
      sections.map((s, i) => ({
        assignment_id: assignmentId,
        name: s.name,
        description: s.description || null,
        estimated_hours: s.hours,
        confidence_score: s.confidence ?? null,
        order_index: i,
        status: "todo",
      }))
    );

    if (tasksError) {
      logger.error("Task insert error", { detail: tasksError });
      await rollbackAssignment();
      return NextResponse.json(
        { success: false, error: "Failed to save the assignment's tasks. Please try again." },
        { status: 500 }
      );
    }
  }

  if (checklist.length > 0) {
    const { error: checklistError } = await supabase.from("assignment_checklist").insert(
      checklist.map((item) => ({
        assignment_id: assignmentId,
        category: item.category,
        label: item.label,
        detail: item.detail || null,
        confidence: item.confidence ?? null,
        checked: false,
      }))
    );

    if (checklistError) {
      logger.error("Checklist insert error", { detail: checklistError });
      await rollbackAssignment();
      return NextResponse.json(
        { success: false, error: "Failed to save the assignment's checklist. Please try again." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true, data: { id: assignmentId } });
}
