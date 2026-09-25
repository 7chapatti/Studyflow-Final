"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getPaceStatus } from "@/lib/pace";
import { toIsoWithTimezone } from "@/lib/datetime";
import { UpdateAssignmentSchema } from "@/lib/validation";
import type { Assignment, Task, ChecklistItem, PaceLog, Priority } from "@/types";
import { COLOUR_PALETTE } from "@/types";
import { ArchiveIcon, BrainIcon, CalendarIcon, CheckIcon, ChevronLeftIcon, ClockIcon, FlagIcon, PencilIcon, PlayIcon, XIcon } from "@/components/icons";

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const colour = pct >= 80 ? "bg-green" : pct >= 60 ? "bg-amber" : "bg-red";
  return (
    <span className="flex items-center gap-1.5 shrink-0" title={`AI confidence: ${pct}%`}>
      <span className="w-10 h-1.5 bg-border rounded-full overflow-hidden">
        <span className={`block h-full rounded-full ${colour}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-[10px] font-medium text-dim">{pct}%</span>
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = { low: "text-dim bg-border/40", normal: "text-muted bg-border/40", high: "text-amber bg-amber/10 border border-amber/20", urgent: "text-red bg-red/10 border border-red/20" };
  return (
    <span className={`text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-md font-bold ${styles[priority] ?? styles.normal}`}>
      {priority}
    </span>
  );
}

function CategoryLabel({ category }: { category: string }) {
  const labels: Record<string, string> = { word_limit: "Word limit", references: "References", formatting: "Formatting", sections: "Sections", submission: "Submission", other: "Other" };
  return <span className="text-[11px] uppercase tracking-wider text-muted font-bold">{labels[category] ?? category}</span>;
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
  const [timezone, setTimezone] = useState("Europe/London");

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDeadlineDate, setEditDeadlineDate] = useState("");
  const [editDeadlineTime, setEditDeadlineTime] = useState("");
  const [editPriority, setEditPriority] = useState<Priority>("normal");
  const [editError, setEditError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const [{ data: asgn, error: asgnErr }, { data: taskData }, { data: checkData }, { data: paceData }, { data: profileData }] = await Promise.all([
      supabase.from("assignments").select("*").eq("id", id).eq("user_id", user.id).single(),
      supabase.from("tasks").select("*").eq("assignment_id", id).order("order_index"),
      supabase.from("assignment_checklist").select("*").eq("assignment_id", id),
      supabase.from("pace_log").select("*").eq("user_id", user.id).order("logged_at", { ascending: false }).limit(20),
      supabase.from("profiles").select("timezone").eq("id", user.id).single(),
    ]);

    if (asgnErr || !asgn) { setError("Assignment not found."); setLoading(false); return; }

    setAssignment(asgn as Assignment); setTasks((taskData ?? []) as Task[]); setChecklist((checkData ?? []) as ChecklistItem[]); setPaceLog((paceData ?? []) as PaceLog[]); setTimezone(profileData?.timezone ?? "Europe/London"); setLoading(false);
  }, [id, router]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleStartTask(task: Task) {
    const supabase = createClient();
    await supabase.from("tasks").update({ status: "in_progress", started_at: new Date().toISOString() }).eq("id", task.id);
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: "in_progress", started_at: new Date().toISOString() } : t));
  }

  async function handleToggleTask(task: Task) {
    const supabase = createClient();
    const isDone = task.status !== "done";
    const now = new Date().toISOString();
    const updates: Partial<Task> = { status: isDone ? "done" : "todo", completed_at: isDone ? now : null };

    if (isDone && task.started_at) {
      const actualHours = (Date.now() - new Date(task.started_at).getTime()) / 3_600_000;
      if (actualHours >= 0.1 && actualHours <= 24) {
        updates.actual_hours = Math.round(actualHours * 100) / 100;
        const { data: { user } } = await supabase.auth.getUser();
        if (user) await supabase.from("pace_log").insert({ user_id: user.id, task_id: task.id, estimated_hours: task.estimated_hours, actual_hours: actualHours });
      }
    }

    await supabase.from("tasks").update(updates).eq("id", task.id);
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...updates } : t)));
    
    const allDone = tasks.map((t) => t.id === task.id ? { ...t, ...updates } : t).every((t) => t.status === "done");
    if (allDone && isDone) {
      await supabase.from("assignments").update({ status: "complete" }).eq("id", id);
      setAssignment((prev) => prev ? { ...prev, status: "complete" } : prev);
    }
  }

  async function handleToggleChecklist(item: ChecklistItem) {
    const supabase = createClient();
    await supabase.from("assignment_checklist").update({ checked: !item.checked }).eq("id", item.id);
    setChecklist((prev) => prev.map((c) => (c.id === item.id ? { ...c, checked: !item.checked } : c)));
  }

  async function handleArchive() {
    if (!confirm("Archive this assignment? It won't count toward your active limit.")) return;
    const supabase = createClient();
    await supabase.from("assignments").update({ status: "archived", archived_at: new Date().toISOString() }).eq("id", id);
    router.push("/dashboard");
  }

  function handleStartEdit() {
    if (!assignment) return;
    const d = new Date(assignment.deadline);
    setEditName(assignment.name); setEditDescription(assignment.description ?? "");
    setEditDeadlineDate(new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d));
    setEditDeadlineTime(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d));
    setEditPriority(assignment.priority); setEditError(""); setEditing(true);
  }

  async function handleSaveEdit() {
    if (!assignment) return;
    setEditError("");
    try {
      const deadlineIso = toIsoWithTimezone(editDeadlineDate, editDeadlineTime || "23:59", timezone);
      const parsed = UpdateAssignmentSchema.safeParse({ name: editName, description: editDescription || undefined, deadline: deadlineIso, priority: editPriority });
      if (!parsed.success) { setEditError(parsed.error.issues[0]?.message ?? "Invalid form."); return; }
      
      setSaving(true);
      const supabase = createClient();
      const { error } = await supabase.from("assignments").update({ name: parsed.data.name, description: parsed.data.description ?? null, deadline: parsed.data.deadline, priority: parsed.data.priority }).eq("id", id);
      if (error) throw error;
      
      setAssignment((prev) => prev ? { ...prev, name: parsed.data.name!, description: parsed.data.description ?? null, deadline: parsed.data.deadline!, priority: parsed.data.priority! } : prev);
      setEditing(false);
    } catch { setEditError("Failed to save changes."); } 
    finally { setSaving(false); }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><span className="w-6 h-6 border-2 border-border border-t-indigo rounded-full animate-spin" /></div>;
  if (error || !assignment) return <div className="p-8 text-center text-red">{error || "Assignment not found."}</div>;

  const colour = COLOUR_PALETTE[assignment.colour_index % COLOUR_PALETTE.length];
  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const progress = tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0;
  const dueDate = new Date(assignment.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const daysLeft = Math.ceil((new Date(assignment.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const paceStatus = getPaceStatus(paceLog);
  const checklistByCategory = checklist.reduce<Record<string, ChecklistItem[]>>((acc, item) => {
    (acc[item.category] = acc[item.category] || []).push(item); return acc;
  }, {});

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <button onClick={() => router.back()} className="flex items-center gap-1.5 text-muted hover:text-text text-sm font-medium transition-colors mb-6">
        <ChevronLeftIcon /> Back
      </button>

      {/* ── HEADER CARD ──────────────────────────────────────────────────────── */}
      <header className="bg-card border border-border rounded-xl shadow-sm mb-6 overflow-hidden relative">
        <div className="absolute left-0 top-0 bottom-0 w-2" style={{ background: colour.border }} />
        
        {editing ? (
          <div className="p-6 pl-8 space-y-5 animate-in fade-in">
            <h2 className="text-sm font-semibold text-text border-b border-border pb-2">Edit Assignment</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">Name</label>
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full bg-navy3 border border-border rounded-lg px-3 py-2 text-text text-sm focus:border-indigo" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">Description</label>
                <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} className="w-full bg-navy3 border border-border rounded-lg px-3 py-2 text-text text-sm focus:border-indigo resize-none" />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-muted mb-1.5">Date</label>
                  <input type="date" value={editDeadlineDate} onChange={(e) => setEditDeadlineDate(e.target.value)} className="w-full bg-navy3 border border-border rounded-lg px-3 py-2 text-text text-sm focus:border-indigo" />
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-muted mb-1.5">Time</label>
                  <input type="time" value={editDeadlineTime} onChange={(e) => setEditDeadlineTime(e.target.value)} className="w-full bg-navy3 border border-border rounded-lg px-3 py-2 text-text text-sm focus:border-indigo" />
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-muted mb-1.5">Priority</label>
                  <select value={editPriority} onChange={(e) => setEditPriority(e.target.value as Priority)} className="w-full bg-navy3 border border-border rounded-lg px-3 py-2 text-text text-sm focus:border-indigo">
                    <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
            </div>
            {editError && <p className="text-red text-xs bg-red/10 border border-red/20 p-2 rounded">{editError}</p>}
            <div className="flex gap-2 pt-2">
              <button onClick={handleSaveEdit} disabled={saving} className="flex-1 flex items-center justify-center gap-2 bg-indigo hover:bg-indigo/90 text-white text-sm font-medium rounded-lg py-2 transition-colors disabled:opacity-50">
                {saving ? "Saving..." : <><CheckIcon size={14} /> Save changes</>}
              </button>
              <button onClick={() => setEditing(false)} disabled={saving} className="flex-1 flex items-center justify-center gap-2 text-muted border border-border hover:bg-navy3 text-sm font-medium rounded-lg py-2 transition-colors">
                <XIcon size={14} /> Cancel
              </button>
            </div>
            <p className="text-dim text-xs text-center mt-2">Note: Organise the calendar manually after changing deadlines.</p>
          </div>
        ) : (
          <div className="p-6 pl-8">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="font-display text-2xl font-semibold text-text">{assignment.name}</h1>
                  <PriorityBadge priority={assignment.priority} />
                </div>
                {assignment.description && <p className="text-muted text-sm leading-relaxed">{assignment.description}</p>}
              </div>
              {assignment.status !== "archived" && (
                <button onClick={handleStartEdit} className="text-muted hover:text-indigo transition-colors p-2 bg-navy3 rounded-md border border-border hover:border-indigo/50">
                  <PencilIcon size={15} />
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted font-medium bg-navy3/30 border border-border/50 rounded-lg p-3 mb-5">
              <span className="flex items-center gap-2"><CalendarIcon size={14} className="text-dim" /> {dueDate}</span>
              <span className="flex items-center gap-2"><ClockIcon size={14} className="text-dim" /> ~{assignment.estimated_hours}h est.</span>
              <span className="flex items-center gap-2">
                <FlagIcon size={14} className={daysLeft <= 3 ? "text-amber" : "text-dim"} /> 
                {daysLeft > 0 ? `${daysLeft} days left` : daysLeft === 0 ? "Due today" : `${Math.abs(daysLeft)} days overdue`}
              </span>
            </div>

            <div>
              <div className="flex justify-between text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                <span>Progress ({doneTasks}/{tasks.length})</span>
                <span className={progress === 100 ? "text-green" : ""}>{progress}%</span>
              </div>
              <div className="h-2 bg-navy3 rounded-full overflow-hidden border border-border/50">
                <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${progress}%`, background: colour.border }} />
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ── PACE BANNER ──────────────────────────────────────────────────────── */}
      <section className={`rounded-xl p-4 mb-8 border flex items-start gap-3 ${paceStatus.isActive ? "bg-green/5 border-green/20" : "bg-card border-border shadow-sm"}`}>
        <div className={`p-2 rounded-lg ${paceStatus.isActive ? "bg-green/10 text-green" : "bg-navy3 text-muted"}`}>
          <BrainIcon size={18} />
        </div>
        <div className="flex-1">
          <h2 className={`text-sm font-semibold mb-0.5 ${paceStatus.isActive ? "text-green" : "text-text"}`}>
            {paceStatus.isActive ? "Pace Profile Active" : "Learning your pace..."}
          </h2>
          <p className={`text-xs leading-relaxed ${paceStatus.isActive ? "text-green/80" : "text-muted"}`}>
            {paceStatus.isActive 
              ? `${paceStatus.description} Adapting future estimates based on ${paceStatus.samplesCollected} completed blocks.` 
              : `${paceStatus.samplesCollected} of ${paceStatus.samplesNeeded} tasks completed. StudyFlow will adapt estimates once enough data is gathered.`}
          </p>
          {!paceStatus.isActive && paceLog.length > 0 && (
            <div className="mt-3 h-1.5 bg-navy3 rounded-full overflow-hidden border border-border">
              <div className="h-full bg-indigo rounded-full transition-all" style={{ width: `${(paceStatus.samplesCollected / paceStatus.samplesNeeded) * 100}%` }} />
            </div>
          )}
        </div>
      </section>

      <div className="grid md:grid-cols-3 gap-8">
        
        {/* ── TASKS LIST ────────────────────────────────────────────────────── */}
        <section className="md:col-span-2">
          <h2 className="font-display text-lg font-semibold text-text mb-4 border-b border-border pb-2">Study Plan</h2>
          <ul className="space-y-3">
            {tasks.map((task) => (
              <li key={task.id} className={`bg-card border rounded-xl p-4 transition-all ${task.status === "done" ? "border-border/50 opacity-60 bg-navy3/30" : task.status === "in_progress" ? "border-amber/40 shadow-sm ring-1 ring-amber/10" : "border-border shadow-sm hover:border-indigo/40"}`}>
                <div className="flex items-start gap-4">
                  <button onClick={() => handleToggleTask(task)} className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${task.status === "done" ? "bg-green border-green text-navy" : "border-border hover:border-indigo bg-card"}`}>
                    {task.status === "done" && <CheckIcon size={12} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <p className={`text-sm font-semibold ${task.status === "done" ? "line-through text-dim" : "text-text"}`}>{task.name}</p>
                      {task.status === "in_progress" && <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber/10 text-amber font-bold border border-amber/20">Working</span>}
                    </div>
                    {task.description && <p className="text-muted text-xs leading-relaxed mb-2">{task.description}</p>}
                    <div className="flex items-center gap-4 flex-wrap">
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-dim"><ClockIcon size={12} /> ~{task.estimated_hours}h est.</span>
                      {task.actual_hours && <span className="text-[11px] font-medium text-indigo bg-indigo/10 px-1.5 rounded">{task.actual_hours.toFixed(1)}h actual</span>}
                      {task.confidence_score != null && <ConfidenceBar value={task.confidence_score} />}
                    </div>
                  </div>
                  {task.status === "todo" && (
                    <button onClick={() => handleStartTask(task)} className="flex flex-col items-center justify-center gap-1 text-[10px] uppercase tracking-wider font-bold text-indigo bg-indigo/10 hover:bg-indigo/20 border border-indigo/20 rounded-lg w-12 h-12 transition-all shrink-0">
                      <PlayIcon size={14} /> Start
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* ── CHECKLIST ─────────────────────────────────────────────────────── */}
        <section className="md:col-span-1">
          <h2 className="font-display text-lg font-semibold text-text mb-4 border-b border-border pb-2">Requirements</h2>
          <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
            {Object.entries(checklistByCategory).map(([category, items], catIdx) => (
              <div key={category} className={catIdx > 0 ? "border-t border-border" : ""}>
                <div className="px-3 py-2 bg-navy3 border-b border-border">
                  <CategoryLabel category={category} />
                </div>
                <ul className="divide-y divide-border/50">
                  {items.map((item) => (
                    <li key={item.id} className="flex items-start gap-3 px-3 py-3 hover:bg-navy3/30 transition-colors">
                      <button onClick={() => handleToggleChecklist(item)} className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-all ${item.checked ? "bg-green border-green text-navy" : "border-border bg-card hover:border-indigo"}`}>
                        {item.checked && <CheckIcon size={10} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[13px] leading-snug font-medium ${item.checked ? "line-through text-dim" : "text-text"}`}>{item.label}</p>
                        {item.detail && <p className="text-dim text-[11px] mt-1 leading-relaxed">{item.detail}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {checklist.length === 0 && (
              <div className="p-4 text-center text-muted text-sm">No specific requirements found.</div>
            )}
          </div>

          {/* Archive Action */}
          {assignment.status !== "archived" && (
            <button onClick={handleArchive} className="w-full mt-6 flex items-center justify-center gap-2 text-dim hover:text-text hover:bg-navy3 border border-transparent hover:border-border text-sm font-medium rounded-lg py-2 transition-all">
              <ArchiveIcon size={14} /> Archive Assignment
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
