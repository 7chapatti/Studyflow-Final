"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { BlockedTime, DayOfWeek } from "@/types";
import { DAYS_OF_WEEK } from "@/types";
import { CheckIcon, PencilIcon, PlusIcon, ResetIcon, TrashIcon, XIcon } from "@/components/icons";

function fmt24(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour % 1) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function TimeInput({ id, value, onChange, label }: { id: string; value: number; onChange: (v: number) => void; label: string; }) {
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
      <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">{label}</p>
      <div className="flex items-center gap-1 bg-card border border-border focus-within:border-indigo focus-within:ring-1 focus-within:ring-indigo/20 rounded-lg px-2 py-2 w-fit transition-all shadow-sm">
        <input id={id} type="text" inputMode="numeric" maxLength={2} value={hourStr} onChange={(e) => setHourStr(e.target.value)} onBlur={() => commit(hourStr, minStr)} className="w-7 bg-transparent text-text text-sm font-medium text-center focus:outline-none" aria-label="Hour" />
        <span className="text-dim text-sm font-medium">:</span>
        <input type="text" inputMode="numeric" maxLength={2} value={minStr} onChange={(e) => setMinStr(e.target.value)} onBlur={() => commit(hourStr, minStr)} className="w-7 bg-transparent text-text text-sm font-medium text-center focus:outline-none" aria-label="Minute" />
      </div>
    </div>
  );
}

const EMPTY_FORM = { label: "", days: [] as DayOfWeek[], startHour: 9, endHour: 17, repeatWeekly: true };

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

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3000); }

  useEffect(() => { loadBlocked(); }, []);

  async function loadBlocked() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    const { data } = await supabase.from("blocked_times").select("*").eq("user_id", user.id).order("start_hour");
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
    const { data: schedBlocks } = await supabase.from("scheduled_blocks").select("id, start_time, end_time").eq("user_id", user.id).gte("start_time", now.toISOString()).lte("start_time", sevenDaysLater.toISOString());
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const idsToDelete: string[] = [];
    for (const sb of schedBlocks ?? []) {
      const start = new Date(sb.start_time);
      if (!(bt.days as string[]).includes(days[start.getDay()])) continue;
      const startH = start.getHours() + start.getMinutes() / 60;
      const endH = new Date(sb.end_time).getHours() + new Date(sb.end_time).getMinutes() / 60;
      if (startH < Number(bt.end_hour) && endH > Number(bt.start_hour)) idsToDelete.push(sb.id);
    }
    if (idsToDelete.length > 0) await supabase.from("scheduled_blocks").delete().in("id", idsToDelete);
    setResettingId(null);
    showToast(`✓ Reset "${bt.label}" — run Organise to reschedule`);
  }

  async function resetAllBlockedTimes() {
    if (!confirm("Reset all blocked times? This removes manual overlaps. Run Organise afterwards.")) return;
    setResettingAll(true);
    for (const bt of blocked) await resetBlockedTime(bt);
    setResettingAll(false); showToast("✓ All blocked times reset");
  }

  function toggleDay(day: DayOfWeek, isEdit = false) {
    const update = (prev: typeof EMPTY_FORM) => ({ ...prev, days: prev.days.includes(day) ? prev.days.filter((d) => d !== day) : [...prev.days, day] });
    isEdit ? setEditForm(update) : setForm(update);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault(); setFormError("");
    if (!form.label.trim()) { setFormError("Enter a label."); return; }
    if (form.days.length === 0) { setFormError("Select a day."); return; }
    if (form.endHour <= form.startHour) { setFormError("End time must be after start."); return; }
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from("blocked_times").insert({ user_id: user.id, label: form.label.trim(), days: form.days, start_hour: form.startHour, end_hour: form.endHour, repeat_weekly: form.repeatWeekly }).select().single();
    if (error) setFormError("Failed to save."); else { setBlocked((prev) => [...prev, data as BlockedTime]); setForm(EMPTY_FORM); }
    setSaving(false);
  }

  async function handleDelete(id: string, label: string) {
    if (!confirm(`Remove "${label}"?`)) return;
    await createClient().from("blocked_times").delete().eq("id", id);
    setBlocked((prev) => prev.filter((b) => b.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function startEdit(bt: BlockedTime) {
    setEditingId(bt.id); setEditForm({ label: bt.label, days: bt.days as DayOfWeek[], startHour: bt.start_hour, endHour: bt.end_hour, repeatWeekly: bt.repeat_weekly }); setEditError("");
  }

  async function handleSaveEdit() {
    setEditError("");
    if (!editForm.label.trim() || editForm.days.length === 0 || editForm.endHour <= editForm.startHour) { setEditError("Invalid form."); return; }
    const { data, error } = await createClient().from("blocked_times").update({ label: editForm.label.trim(), days: editForm.days, start_hour: editForm.startHour, end_hour: editForm.endHour, repeat_weekly: editForm.repeatWeekly }).eq("id", editingId!).select().single();
    if (error) { setEditError("Failed to save."); return; }
    setBlocked((prev) => prev.map((b) => (b.id === editingId ? (data as BlockedTime) : b)));
    setEditingId(null);
  }

  // Shared form UI renderer
  const renderForm = (state: typeof EMPTY_FORM, setter: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>, errorMsg: string, isEdit: boolean) => (
    <div className="space-y-5 animate-in fade-in slide-in-from-top-2">
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">Label</label>
          <input type="text" value={state.label} onChange={(e) => setter((p) => ({ ...p, label: e.target.value }))} maxLength={40} placeholder="e.g. Lectures, Work" className="w-full bg-card border border-border text-text placeholder-dim rounded-lg px-3 py-2.5 text-sm font-medium focus:border-indigo shadow-sm transition-colors" />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">Days</label>
          <div className="flex flex-wrap gap-1.5">
            {DAYS_OF_WEEK.map((day) => (
              <label key={day} className={`cursor-pointer px-2.5 py-1.5 rounded-md border text-[11px] font-bold uppercase tracking-wide transition-all shadow-sm ${state.days.includes(day) ? "bg-indigo text-white border-indigo" : "bg-card border-border text-muted hover:border-indigo/50"}`}>
                <input type="checkbox" checked={state.days.includes(day)} onChange={() => toggleDay(day, isEdit)} className="sr-only" />
                {day.substring(0, 3)}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-end gap-6">
        <TimeInput id={`${isEdit ? 'edit' : 'add'}-start`} value={state.startHour} onChange={(v) => setter((p) => ({ ...p, startHour: v }))} label="Start" />
        <div className="w-4 h-[1px] bg-border mb-5" />
        <TimeInput id={`${isEdit ? 'edit' : 'add'}-end`} value={state.endHour} onChange={(v) => setter((p) => ({ ...p, endHour: v }))} label="End" />
        
        <label className="flex items-center gap-2 cursor-pointer ml-auto mb-3 text-sm font-medium text-muted hover:text-text transition-colors">
          <input type="checkbox" checked={state.repeatWeekly} onChange={(e) => setter((p) => ({ ...p, repeatWeekly: e.target.checked }))} className="w-4 h-4 rounded border-border accent-indigo" />
          Repeat Weekly
        </label>
      </div>
      {errorMsg && <p className="text-red text-xs font-medium bg-red/10 px-3 py-2 rounded-lg border border-red/20 inline-block">{errorMsg}</p>}
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <header className="mb-8 border-b border-border pb-6">
        <h1 className="font-display text-2xl font-semibold text-text mb-2">Blocked Times</h1>
        <p className="text-muted text-sm">Set regular commitments. StudyFlow will schedule your tasks around them automatically.</p>
      </header>

      {/* Add form */}
      <section className="bg-navy3/30 border border-border rounded-xl p-6 mb-8 shadow-sm">
        <h2 className="text-sm font-semibold text-text mb-5 flex items-center gap-2"><PlusIcon size={16} className="text-indigo" /> Add New Block</h2>
        <form onSubmit={handleAdd} noValidate>
          {renderForm(form, setForm, formError, false)}
          <div className="mt-6 pt-5 border-t border-border flex justify-end">
            <button type="submit" disabled={saving} className="flex items-center gap-2 bg-indigo hover:bg-indigo/90 text-white shadow-sm text-sm font-medium rounded-lg px-5 py-2.5 transition-all disabled:opacity-50">
              {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : "Save to Calendar"}
            </button>
          </div>
        </form>
      </section>

      {/* Current blocked times */}
      <section>
        <div className="flex items-center justify-between mb-4 px-1">
          <h2 className="text-sm font-semibold text-text">Active Blocks ({blocked.length})</h2>
          {blocked.length > 0 && (
            <button onClick={resetAllBlockedTimes} disabled={resettingAll} className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted hover:text-text transition-colors disabled:opacity-50">
              {resettingAll ? "Resetting..." : <><ResetIcon size={14} /> Reset All Offsets</>}
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32"><span className="w-6 h-6 border-2 border-border border-t-indigo rounded-full animate-spin" /></div>
        ) : blocked.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl bg-card">
            <p className="text-muted text-sm">No blocked times yet. Use the form above to add one.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {blocked.map((bt) => (
              <li key={bt.id} className="bg-card border border-border rounded-xl shadow-sm overflow-hidden transition-all hover:border-indigo/30 group">
                {editingId === bt.id ? (
                  <div className="p-6 bg-indigo/5 border-b border-indigo/10">
                    <h3 className="text-indigo text-sm font-semibold mb-5 flex items-center gap-2"><PencilIcon size={16} /> Editing: {bt.label}</h3>
                    {renderForm(editForm, setEditForm, editError, true)}
                    <div className="mt-6 pt-5 border-t border-indigo/10 flex justify-end gap-3">
                      <button onClick={() => setEditingId(null)} className="px-4 py-2 text-sm font-medium text-muted hover:bg-card hover:text-text border border-transparent hover:border-border rounded-lg transition-all">Cancel</button>
                      <button onClick={handleSaveEdit} className="flex items-center gap-2 bg-indigo text-white px-5 py-2 text-sm font-medium rounded-lg shadow-sm hover:bg-indigo/90 transition-all">
                        <CheckIcon size={14} /> Save Changes
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-4 sm:p-5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1.5">
                        <p className="text-text text-base font-semibold truncate">{bt.label}</p>
                        {bt.repeat_weekly && <span className="text-[10px] uppercase tracking-wider font-bold bg-indigo/10 text-indigo px-2 py-0.5 rounded-md border border-indigo/20">Weekly</span>}
                      </div>
                      <p className="text-muted text-sm font-medium flex items-center gap-2">
                        <span className="text-text">{bt.days.join(", ")}</span>
                        <span className="text-border">•</span>
                        {fmt24(bt.start_hour)} – {fmt24(bt.end_hour)}
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <button onClick={() => resetBlockedTime(bt)} disabled={resettingId === bt.id} className="p-2 text-dim hover:text-indigo hover:bg-indigo/10 rounded-lg transition-colors" title="Reset offsets">
                        {resettingId === bt.id ? <span className="w-4 h-4 border-2 border-dim border-t-indigo rounded-full animate-spin" /> : <ResetIcon size={16} />}
                      </button>
                      <button onClick={() => startEdit(bt)} className="p-2 text-dim hover:text-indigo hover:bg-indigo/10 rounded-lg transition-colors" aria-label="Edit">
                        <PencilIcon size={16} />
                      </button>
                      <button onClick={() => handleDelete(bt.id, bt.label)} className="p-2 text-dim hover:text-red hover:bg-red/10 rounded-lg transition-colors" aria-label="Delete">
                        <TrashIcon size={16} />
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {toast && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-navy border border-border shadow-2xl text-text text-sm font-medium px-5 py-3 rounded-full z-50 animate-in fade-in slide-in-from-bottom-4">{toast}</div>}
    </div>
  );
}
