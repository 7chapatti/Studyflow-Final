"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getPaceStatus } from "@/lib/pace";
import type {
  Assignment,
  Task,
  ChecklistItem,
  PaceLog,
} from "@/types";
import { COLOUR_PALETTE } from "@/types";
import { ArchiveIcon, BrainIcon, CalendarIcon, CheckIcon, ChevronLeftIcon, ClockIcon, FlagIcon, PlayIcon } from "@/components/icons";

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const colour = pct >= 80 ? "bg-green" : pct >= 60 ? "bg-amber" : "bg-red";
  return (
    <span className="flex items-center gap-1 shrink-0" title={`AI confidence: ${pct}%`}>
      <span className="w-10 h-1 bg-border rounded-full overflow-hidden">
        <span className={`block h-full rounded-full ${colour}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs text-dim">{pct}%</span>
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    low: "text-dim bg-border/30",
    normal: "text-muted bg-border/30",
    high: "text-amber bg-amber/10",
    urgent: "text-red bg-red/10",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[priority] ?? styles.normal}`}>
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </span>
  );
}

function CategoryLabel({ category }: { category: string }) {
  const labels: Record<string, string> = {
    word_limit: "Word limit",
    references: "References",
    formatting: "Formatting",
    sections: "Sections",
    submission: "Submission",
    other: "Other",
  };
  return (
    <span className="text-xs text-dim font-medium uppercase tracking-wider">
      {labels[category] ?? category}
    </span>
  );
}

export default function AssignmentPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [paceLog, setPaceLog] = useState<PaceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const [
      { data: asgn, error: asgnErr },
      { data: taskData },
      { data: checkData },
      { data: paceData },
    ] = await Promise.all([
      supabase.from("assignments").select("*").eq("id", id).eq("user_id", user.id).single(),
      supabase.from("tasks").select("*").eq("assignment_id", id).order("order_index"),
      supabase.from("assignment_checklist").select("*").eq("assignment_id", id),
      supabase.from("pace_log").select("*").eq("user_id", user.id).order("logged_at", { ascending: false }).limit(20),
    ]);

    if (asgnErr || !asgn) { setError("Assignment not found."); setLoading(false); return; }

    setAssignment(asgn as Assignment);
    setTasks((taskData ?? []) as Task[]);
    setChecklist((checkData ?? []) as ChecklistItem[]);
    setPaceLog((paceData ?? []) as PaceLog[]);
    setLoading(false);
  }, [id, router]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleStartTask(task: Task) {
    const supabase = createClient();
    await supabase
      .from("tasks")
      .update({ status: "in_progress", started_at: new Date().toISOString() })
      .eq("id", task.id);
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id ? { ...t, status: "in_progress", started_at: new Date().toISOString() } : t
      )
    );
  }

  async function handleToggleTask(task: Task) {
    const supabase = createClient();
    const isDone = task.status !== "done";
    const now = new Date().toISOString();

    const updates: Partial<Task> = {
      status: isDone ? "done" : "todo",
      completed_at: isDone ? now : null,
    };
    if (isDone && task.started_at) {
      const actualHours =
        (Date.now() - new Date(task.started_at).getTime()) / 3_600_000;
      if (actualHours >= 0.1 && actualHours <= 24) {
        updates.actual_hours = Math.round(actualHours * 100) / 100;
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("pace_log").insert({
            user_id: user.id,
            task_id: task.id,
            estimated_hours: task.estimated_hours,
            actual_hours: actualHours,
          });
        }
      }
    }

    await supabase.from("tasks").update(updates).eq("id", task.id);
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, ...updates } : t))
    );

    const updatedTasks = tasks.map((t) =>
      t.id === task.id ? { ...t, ...updates } : t
    );
    if (updatedTasks.every((t) => t.status === "done") && isDone) {
      await supabase
        .from("assignments")
        .update({ status: "complete" })
        .eq("id", id);
      setAssignment((prev) => prev ? { ...prev, status: "complete" } : prev);
    }
  }

  async function handleToggleChecklist(item: ChecklistItem) {
    const supabase = createClient();
    const newChecked = !item.checked;
    await supabase
      .from("assignment_checklist")
      .update({ checked: newChecked })
      .eq("id", item.id);
    setChecklist((prev) =>
      prev.map((c) => (c.id === item.id ? { ...c, checked: newChecked } : c))
    );
  }

  async function handleCheckAll() {
    const supabase = createClient();
    const now = new Date().toISOString();
    const incompleteTasks = tasks.filter((t) => t.status !== "done");
    if (incompleteTasks.length === 0) return;

    await supabase
      .from("tasks")
      .update({ status: "done", completed_at: now })
      .in("id", incompleteTasks.map((t) => t.id));

    await supabase
      .from("assignments")
      .update({ status: "complete" })
      .eq("id", id);

    setTasks((prev) =>
      prev.map((t) => ({ ...t, status: "done" as const, completed_at: now }))
    );
    setAssignment((prev) => (prev ? { ...prev, status: "complete" } : prev));
  }

  async function handleStartAll() {
    const supabase = createClient();
    const now = new Date().toISOString();
    const todoTasks = tasks.filter((t) => t.status === "todo");
    if (todoTasks.length === 0) return;

    await supabase
      .from("tasks")
      .update({ status: "in_progress", started_at: now })
      .in("id", todoTasks.map((t) => t.id));

    setTasks((prev) =>
      prev.map((t) =>
        t.status === "todo"
          ? { ...t, status: "in_progress" as const, started_at: now }
          : t
      )
    );
  }

  async function handleArchive() {
    if (!confirm("Archive this assignment? It won't count toward your active limit.")) return;
    const supabase = createClient();
    await supabase
      .from("assignments")
      .update({ status: "archived", archived_at: new Date().toISOString() })
      .eq("id", id);
    router.push("/dashboard");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="w-6 h-6 border-2 border-border border-t-il rounded-full animate-spin" aria-label="Loading" />
      </div>
    );
  }

  if (error || !assignment) {
    return (
      <div className="p-8 text-center">
        <p className="text-red">{error || "Assignment not found."}</p>
        <button onClick={() => router.push("/dashboard")} className="mt-4 text-il text-sm hover:underline">
          Back to calendar
        </button>
      </div>
    );
  }

  const colour = COLOUR_PALETTE[assignment.colour_index % COLOUR_PALETTE.length];
  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const totalTasks = tasks.length;
  const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const dueDate = new Date(assignment.deadline).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });
  const daysLeft = Math.ceil(
    (new Date(assignment.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  const paceStatus = getPaceStatus(paceLog);
  const checklistDone = checklist.filter((c) => c.checked).length;
  const checklistTotal = checklist.length;

  // Group checklist by category
  const checklistByCategory = checklist.reduce<Record<string, ChecklistItem[]>>(
    (acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    },
    {}
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Back button */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-muted hover:text-text text-sm transition-colors mb-6"
      >
        <ChevronLeftIcon />
        Back
      </button>

      {/* Assignment header */}
      <header className="bg-card border border-border rounded-xl p-5 mb-6" style={{ borderLeft: `3px solid ${colour.border}` }}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <h1 className="font-sora text-xl font-semibold text-text leading-snug">
            {assignment.name}
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            <PriorityBadge priority={assignment.priority} />
            {assignment.status === "complete" && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium text-green bg-green/10">
                Complete
              </span>
            )}
          </div>
        </div>

        {assignment.description && (
          <p className="text-muted text-sm leading-relaxed mb-3">
            {assignment.description}
          </p>
        )}

        <div className="flex flex-wrap gap-4 text-sm text-muted mb-4">
          <span className="flex items-center gap-1.5">
            <CalendarIcon size={13} />
            Due {dueDate}
          </span>
          <span className="flex items-center gap-1.5">
            <ClockIcon />
            ~{assignment.estimated_hours}h estimated
          </span>
          <span className="flex items-center gap-1.5">
            <FlagIcon />
            {daysLeft > 0 ? `${daysLeft} day${daysLeft !== 1 ? "s" : ""} left` : daysLeft === 0 ? "Due today" : `${Math.abs(daysLeft)} days overdue`}
          </span>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-xs text-muted mb-1.5">
            <span>{doneTasks} of {totalTasks} sections done</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 bg-navy3 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, background: colour.border }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>

        {/* All done banner */}
        {progress === 100 && (
          <div className="mt-3 flex items-center gap-2 text-green text-sm bg-green/10 border border-green/20 rounded-lg px-3 py-2">
            <CheckIcon size={13} />
            All sections complete — great work!
          </div>
        )}
      </header>

      {/* Pace profile — shown once active */}
      {paceStatus.isActive && (
        <section className="bg-green/5 border border-green/20 rounded-xl p-4 mb-6">
          <h2 className="flex items-center gap-2 text-green text-sm font-medium mb-2">
            <BrainIcon />
            Pace profile active
          </h2>
          <p className="text-muted text-xs leading-relaxed">
            {paceStatus.description} Based on {paceStatus.samplesCollected} completed tasks.
          </p>
        </section>
      )}

      {paceLog.length > 0 && !paceStatus.isActive && (
        <section className="bg-card border border-border rounded-xl p-4 mb-6">
          <h2 className="flex items-center gap-2 text-muted text-sm font-medium mb-1">
            <BrainIcon />
            Learning your pace…
          </h2>
          <p className="text-dim text-xs">
            {paceStatus.samplesCollected} of {paceStatus.samplesNeeded} tasks completed. StudyFlow will start adapting estimates once it has enough data.
          </p>
          <div className="mt-2 h-1 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo rounded-full transition-all"
              style={{ width: `${(paceStatus.samplesCollected / paceStatus.samplesNeeded) * 100}%` }}
            />
          </div>
        </section>
      )}

      {/* Tasks */}
      <section aria-labelledby="tasks-label" className="mb-6">
        <h2 id="tasks-label" className="font-sora text-base font-semibold text-text mb-3">
          Sections
        </h2>
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              className={`bg-card border border-border rounded-xl p-4 transition-opacity ${task.status === "done" ? "opacity-60" : ""}`}
            >
              <div className="flex items-start gap-3">
                {/* Checkbox */}
                <button
                  onClick={() => handleToggleTask(task)}
                  className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                    task.status === "done"
                      ? "bg-green border-green text-navy"
                      : "border-border hover:border-indigo"
                  }`}
                  aria-label={task.status === "done" ? `Mark "${task.name}" as not done` : `Mark "${task.name}" as done`}
                >
                  {task.status === "done" && <CheckIcon size={13} />}
                </button>

                {/* Task info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-sm font-medium ${task.status === "done" ? "line-through text-dim" : "text-text"}`}>
                      {task.name}
                    </p>
                    {task.status === "in_progress" && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber/10 text-amber font-medium">
                        In progress
                      </span>
                    )}
                  </div>
                  {task.description && (
                    <p className="text-dim text-xs mt-0.5 leading-relaxed">{task.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <span className="flex items-center gap-1 text-xs text-muted">
                      <ClockIcon />
                      ~{task.estimated_hours}h estimated
                    </span>
                    {task.actual_hours && (
                      <span className="text-xs text-muted">
                        {task.actual_hours.toFixed(1)}h actual
                      </span>
                    )}
                    {task.confidence_score != null && (
                      <ConfidenceBar value={task.confidence_score} />
                    )}
                  </div>
                </div>

                {/* Start button */}
                {task.status === "todo" && (
                  <button
                    onClick={() => handleStartTask(task)}
                    className="flex items-center gap-1.5 text-xs text-amber border border-amber/30 bg-amber/5 hover:bg-amber/10 rounded-lg px-3 py-1.5 transition-all shrink-0"
                  >
                    <PlayIcon />
                    Start
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Checklist */}
      {checklist.length > 0 && (
        <section aria-labelledby="checklist-label" className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 id="checklist-label" className="font-sora text-base font-semibold text-text">
              Submission checklist
            </h2>
            <span className="text-xs text-muted">
              {checklistDone} / {checklistTotal} checked
            </span>
          </div>

          {checklistDone === checklistTotal && checklistTotal > 0 && (
            <div className="flex items-center gap-2 text-green text-sm bg-green/10 border border-green/20 rounded-lg px-3 py-2 mb-3">
              <CheckIcon size={13} />
              All requirements checked — ready to submit!
            </div>
          )}

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {Object.entries(checklistByCategory).map(([category, items], catIdx) => (
              <div key={category} className={catIdx > 0 ? "border-t border-border" : ""}>
                <div className="px-4 py-2 bg-navy3/50">
                  <CategoryLabel category={category} />
                </div>
                <ul>
                  {items.map((item, idx) => (
                    <li
                      key={item.id}
                      className={`flex items-start gap-3 px-4 py-3 ${idx > 0 ? "border-t border-border/50" : ""}`}
                    >
                      <button
                        onClick={() => handleToggleChecklist(item)}
                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                          item.checked
                            ? "bg-green border-green text-navy"
                            : "border-border hover:border-indigo"
                        }`}
                        aria-label={item.checked ? `Uncheck "${item.label}"` : `Check "${item.label}"`}
                      >
                        {item.checked && <CheckIcon size={13} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${item.checked ? "line-through text-dim" : "text-text"}`}>
                          {item.label}
                        </p>
                        {item.detail && (
                          <p className="text-dim text-xs mt-0.5">{item.detail}</p>
                        )}
                        {item.confidence != null && item.confidence < 0.7 && (
                          <p className="text-dim text-xs mt-0.5 italic">
                            Inferred — verify in your brief
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Archive button */}
      {assignment.status !== "archived" && (
        <div className="pt-4 border-t border-border">
          <button
            onClick={handleArchive}
            className="flex items-center gap-2 text-dim hover:text-muted text-sm transition-colors"
          >
            <ArchiveIcon />
            Archive assignment
          </button>
        </div>
      )}
    </div>
  );
}
