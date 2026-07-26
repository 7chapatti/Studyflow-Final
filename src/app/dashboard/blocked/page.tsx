"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { BlockedTime, DayOfWeek } from "@/types";
import { DAYS_OF_WEEK } from "@/types";

function PlusIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
}
function PencilIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
}
function TrashIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;
}
function CheckIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>;
}
function XIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
}
function ResetIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>;
}

function fmt24(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour % 1) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ── Time text input (replaces select) ─────────────────────────────────────────

function TimeInput({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const h = Math.floor(value);
  const m = Math.round((value % 1) * 60);
  const [hourStr, setHourStr] = useState(String(h).padStart(2, "0"));
  const [minStr, setMinStr] = useState(String(m).padStart(2, "0"));

  useEffect(() => {
    setHourStr(String(Math.floor(value)).padStart(2, "0"));
    setMinStr(String(Math.round((value % 1) * 60)).padStart(2, "0"));
  }, [value]);

  function commit(newH: string, newM: string) {
    const hh = Math.max(0, Math.min(23, parseInt(newH) || 0));
    const mm = Math.max(0, Math.min(59, parseInt(newM) || 0));
    const snappedM = mm < 15 ? 0 : mm < 45 ? 30 : 0;
    const snappedH = mm >= 45 ? Math.min(23, hh + 1) : hh;
    onChange(snappedH + snappedM / 60);
    setHourStr(String(snappedH).padStart(2, "0"));
    setMinStr(String(snappedM).padStart(2, "0"));
  }

  return (
    <div>
      <p className="text-xs font-medium text-il mb-1.5">{label}</p>
      <div className="flex items-center gap-1 bg-navy3 border border-border rounded-lg px-2 py-2 w-fit">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          maxLength={2}
          value={hourStr}
          onChange={(e) => setHourStr(e.target.value)}
          onBlur={() => commit(hourStr, minStr)}
          className="w-6 bg-transparent text-text text-sm text-center focus:outline-none"
          aria-label="Hour"
        />
        <span className="text-dim text-sm">:</span>
        <input
          type="text"
          inputMode="numeric"
          maxLength={2}
          value={minStr}
          onChange={(e) => setMinStr(e.target.value)}
          onBlur={() => commit(hourStr, minStr)}
          className="w-6 bg-transparent text-text text-sm text-center focus:outline-none"
          aria-label="Minute"
        />
      </div>
    </div>
  );
}

const EMPTY_FORM = {
  label: "",
  days: [] as DayOfWeek[],
  startHour: 9,
  endHour: 17,
  repeatWeekly: true,
};

export default function BlockedTimesPage() {
  const router = useRouter();
  const [blocked, setBlocked] = useState<BlockedTime[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editError, setEditError] = useState("");
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resettingAll, setResettingAll] = useState(false);
  const [toast, setToast] = useState("");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  useEffect(() => { loadBlocked(); }, []);

  async function loadBlocked() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    const { data } = await supabase
      .from("blocked_times").select("*").eq("user_id", user.id).order("start_hour");
    setBlocked((data ?? []) as BlockedTime[]);
    setLoading(false);
  }

  async function resetBlockedTime(bt: BlockedTime) {
    setResettingId(bt.id);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 3_600_000);

    const { data: schedBlocks } = await supabase
      .from("scheduled_blocks")
      .select("id, start_time, end_time")
      .eq("user_id", user.id)
      .gte("start_time", now.toISOString())
      .lte("start_time", sevenDaysLater.toISOString());

    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const idsToDelete: string[] = [];

    for (const sb of schedBlocks ?? []) {
      const start = new Date(sb.start_time);
      const dayName = days[start.getDay()];
      if (!(bt.days as string[]).includes(dayName)) continue;
      const startH = start.getHours() + start.getMinutes() / 60;
      const endH = new Date(sb.end_time).getHours() + new Date(sb.end_time).getMinutes() / 60;
      if (startH < Number(bt.end_hour) && endH > Number(bt.start_hour)) {
        idsToDelete.push(sb.id);
      }
    }

    if (idsToDelete.length > 0) {
      await supabase.from("scheduled_blocks").delete().in("id", idsToDelete);
    }

    setResettingId(null);
    showToast(`✓ Reset "${bt.label}" — run Organise to reschedule around it`);
  }

  async function resetAllBlockedTimes() {
    if (!confirm("Reset all blocked times? This will remove any manually moved task blocks that overlap with your blocked times. Run Organise afterwards to reschedule.")) return;
    setResettingAll(true);
    for (const bt of blocked) {
      await resetBlockedTime(bt);
    }
    setResettingAll(false);
    showToast("✓ All blocked times reset — run Organise to reschedule");
  }

  function toggleDay(day: DayOfWeek, isEdit = false) {
    if (isEdit) {
      setEditForm((prev) => ({
        ...prev,
        days: prev.days.includes(day)
          ? prev.days.filter((d) => d !== day)
          : [...prev.days, day],
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        days: prev.days.includes(day)
          ? prev.days.filter((d) => d !== day)
          : [...prev.days, day],
      }));
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.label.trim()) { setFormError("Please enter a label."); return; }
    if (form.days.length === 0) { setFormError("Select at least one day."); return; }
    if (form.endHour <= form.startHour) { setFormError("End time must be after start time."); return; }
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    const { data, error } = await supabase
      .from("blocked_times")
      .insert({ user_id: user.id, label: form.label.trim(), days: form.days, start_hour: form.startHour, end_hour: form.endHour, repeat_weekly: form.repeatWeekly })
      .select().single();
    if (error) { setFormError("Failed to save. Please try again."); }
    else { setBlocked((prev) => [...prev, data as BlockedTime]); setForm(EMPTY_FORM); }
    setSaving(false);
  }

  async function handleDelete(id: string, label: string) {
    if (!confirm(`Remove "${label}"?`)) return;
    const supabase = createClient();
    await supabase.from("blocked_times").delete().eq("id", id);
    setBlocked((prev) => prev.filter((b) => b.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function startEdit(bt: BlockedTime) {
    setEditingId(bt.id);
    setEditForm({ label: bt.label, days: bt.days as DayOfWeek[], startHour: bt.start_hour, endHour: bt.end_hour, repeatWeekly: bt.repeat_weekly });
    setEditError("");
  }

  async function handleSaveEdit() {
    setEditError("");
    if (!editForm.label.trim()) { setEditError("Please enter a label."); return; }
    if (editForm.days.length === 0) { setEditError("Select at least one day."); return; }
    if (editForm.endHour <= editForm.startHour) { setEditError("End time must be after start time."); return; }
    if (!confirm(`Save changes to "${blocked.find((b) => b.id === editingId)?.label}"?`)) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("blocked_times")
      .update({ label: editForm.label.trim(), days: editForm.days, start_hour: editForm.startHour, end_hour: editForm.endHour, repeat_weekly: editForm.repeatWeekly })
      .eq("id", editingId!).select().single();
    if (error) { setEditError("Failed to save. Please try again."); return; }
    setBlocked((prev) => prev.map((b) => (b.id === editingId ? (data as BlockedTime) : b)));
    setEditingId(null);
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="font-sora text-2xl font-semibold text-text mb-1">Blocked times</h1>
        <p className="text-muted text-sm">
          Add times you&apos;re unavailable. StudyFlow will schedule around them automatically.
        </p>
      </header>

      {/* Add form */}
      <section aria-labelledby="add-label" className="bg-card border border-border rounded-xl p-5 mb-8">
        <h2 id="add-label" className="font-sora text-base font-semibold text-text mb-4">
          Block out a time
        </h2>
        <form onSubmit={handleAdd} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="bl-label" className="block text-xs font-medium text-il">Label</label>
            <input
              id="bl-label"
              type="text"
              value={form.label}
              onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))}
              maxLength={40}
              placeholder="e.g. Work, Football, Lectures"
              className="w-full bg-navy3 border border-border text-text placeholder-dim rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo transition-colors"
            />
          </div>

          <fieldset>
            <legend className="text-xs font-medium text-il mb-2 block">
              Days <span className="text-dim font-normal">(select one or more)</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {DAYS_OF_WEEK.map((day) => (
                <label
                  key={day}
                  className={`cursor-pointer px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                    form.days.includes(day)
                      ? "bg-indigo/20 border-indigo text-il"
                      : "border-border text-muted hover:border-indigo/50"
                  }`}
                >
                  <input type="checkbox" checked={form.days.includes(day)} onChange={() => toggleDay(day)} className="sr-only" />
                  {day}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-4">
            <TimeInput id="bl-start" value={form.startHour} onChange={(v) => setForm((p) => ({ ...p, startHour: v }))} label="Start time" />
            <TimeInput id="bl-end" value={form.endHour} onChange={(v) => setForm((p) => ({ ...p, endHour: v }))} label="End time" />
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={form.repeatWeekly} onChange={(e) => setForm((p) => ({ ...p, repeatWeekly: e.target.checked }))} className="w-4 h-4 rounded accent-indigo" />
            <span className="text-sm text-muted">Repeat every week</span>
          </label>

          {formError && <p role="alert" className="text-red text-xs">{formError}</p>}

          <button type="submit" disabled={saving} className="flex items-center gap-2 bg-indigo hover:bg-il text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors disabled:opacity-50">
            <PlusIcon />
            {saving ? "Saving…" : "Add to calendar"}
          </button>
        </form>
      </section>

      {/* Current blocked times */}
      <section aria-labelledby="current-label">
        <div className="flex items-center justify-between mb-3">
          <h2 id="current-label" className="font-sora text-base font-semibold text-text">
            Current blocked times
          </h2>
          {blocked.length > 0 && (
            <button
              onClick={resetAllBlockedTimes}
              disabled={resettingAll}
              className="flex items-center gap-1.5 text-xs text-muted border border-border hover:text-text hover:border-indigo/50 rounded-lg px-3 py-1.5 transition-all disabled:opacity-50"
            >
              {resettingAll
                ? <span className="w-3 h-3 border border-muted border-t-il rounded-full animate-spin" />
                : <ResetIcon />}
              Reset all
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-24">
            <span className="w-5 h-5 border-2 border-border border-t-il rounded-full animate-spin" aria-label="Loading" />
          </div>
        ) : blocked.length === 0 ? (
          <p className="text-muted text-sm text-center py-8">No blocked times yet. Add one above.</p>
        ) : (
          <ul className="space-y-2">
            {blocked.map((bt) => (
              <li key={bt.id}>
                {editingId === bt.id ? (
                  <div className="bg-amber/5 border border-amber/25 rounded-xl p-4 space-y-4">
                    <h3 className="text-amber text-sm font-medium">Editing: {bt.label}</h3>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-il">Label</label>
                      <input
                        type="text"
                        value={editForm.label}
                        onChange={(e) => setEditForm((p) => ({ ...p, label: e.target.value }))}
                        maxLength={40}
                        className="w-full bg-navy3 border border-border text-text rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo transition-colors"
                      />
                    </div>

                    <fieldset>
                      <legend className="text-xs font-medium text-il mb-2 block">Days</legend>
                      <div className="flex flex-wrap gap-2">
                        {DAYS_OF_WEEK.map((day) => (
                          <label
                            key={day}
                            className={`cursor-pointer px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                              editForm.days.includes(day)
                                ? "bg-indigo/20 border-indigo text-il"
                                : "border-border text-muted hover:border-indigo/50"
                            }`}
                          >
                            <input type="checkbox" checked={editForm.days.includes(day)} onChange={() => toggleDay(day, true)} className="sr-only" />
                            {day}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <div className="grid grid-cols-2 gap-4">
                      <TimeInput id="edit-start" value={editForm.startHour} onChange={(v) => setEditForm((p) => ({ ...p, startHour: v }))} label="Start time" />
                      <TimeInput id="edit-end" value={editForm.endHour} onChange={(v) => setEditForm((p) => ({ ...p, endHour: v }))} label="End time" />
                    </div>

                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input type="checkbox" checked={editForm.repeatWeekly} onChange={(e) => setEditForm((p) => ({ ...p, repeatWeekly: e.target.checked }))} className="w-4 h-4 rounded accent-indigo" />
                      <span className="text-sm text-muted">Repeat every week</span>
                    </label>

                    {editError && <p role="alert" className="text-red text-xs">{editError}</p>}

                    <div className="flex gap-2">
                      <button onClick={handleSaveEdit} className="flex items-center gap-1.5 bg-indigo hover:bg-il text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">
                        <CheckIcon />
                        Save changes
                      </button>
                      <button onClick={() => setEditingId(null)} className="flex items-center gap-1.5 text-muted border border-border hover:border-indigo/50 text-sm rounded-lg px-4 py-2 transition-colors">
                        <XIcon />
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 bg-card border border-border hover:border-border/80 rounded-xl px-4 py-3 transition-all">
                    <div className="flex-1 min-w-0">
                      <p className="text-text text-sm font-medium">
                        {bt.label}
                        {bt.repeat_weekly && <span className="ml-2 text-xs text-il font-normal">↻ weekly</span>}
                      </p>
                      <p className="text-dim text-xs mt-0.5">
                        {bt.days.join(", ")} · {fmt24(bt.start_hour)} – {fmt24(bt.end_hour)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => resetBlockedTime(bt)}
                        disabled={resettingId === bt.id}
                        className="flex items-center gap-1 text-dim hover:text-muted text-xs border border-border hover:border-indigo/40 rounded-lg px-2.5 py-1.5 transition-all disabled:opacity-50"
                        aria-label={`Reset ${bt.label} to original times`}
                        title="Reset — removes any manually moved blocks for this rule"
                      >
                        {resettingId === bt.id
                          ? <span className="w-3 h-3 border border-dim border-t-muted rounded-full animate-spin" />
                          : <ResetIcon />}
                        Reset
                      </button>
                      <button
                        onClick={() => startEdit(bt)}
                        className="flex items-center gap-1.5 text-il text-xs font-medium bg-indigo/15 border border-indigo/30 hover:bg-indigo/25 rounded-lg px-3 py-1.5 transition-all"
                        aria-label={`Edit ${bt.label}`}
                      >
                        <PencilIcon />
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(bt.id, bt.label)}
                        className="flex items-center justify-center w-8 h-8 text-red bg-red/10 border border-red/25 hover:bg-red/20 rounded-lg transition-all"
                        aria-label={`Delete ${bt.label}`}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-card border border-indigo text-text text-sm px-4 py-2.5 rounded-xl shadow-lg z-50 max-w-sm text-center" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
