"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toIsoWithTimezone } from "@/lib/datetime";
import type { AIAnalysisResult, Priority } from "@/types";
import { CheckIcon, FileIcon, SparklesIcon, UploadIcon, XIcon } from "@/components/icons";

const PRIORITY_OPTIONS: { value: Priority; label: string; colour: string }[] = [
  { value: "low",    label: "Low",    colour: "text-dim border-border hover:border-dim" },
  { value: "normal", label: "Normal", colour: "text-muted border-border hover:border-muted" },
  { value: "high",   label: "High",   colour: "text-amber border-amber/40 hover:border-amber/80" },
  { value: "urgent", label: "Urgent", colour: "text-red border-red/40 hover:border-red/80" },
];

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const colour = pct >= 80 ? "bg-green" : pct >= 60 ? "bg-amber" : "bg-red";
  return (
    <span className="flex items-center gap-2 shrink-0" title={`Confidence: ${pct}%`}>
      <span className="text-[11px] font-medium text-dim w-6 text-right">{pct}%</span>
      <span className="w-12 h-1.5 bg-border rounded-full overflow-hidden" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span className={`block h-full rounded-full ${colour}`} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

export default function NewAssignmentPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [deadlineTime, setDeadlineTime] = useState("23:59");
  const [priority, setPriority] = useState<Priority>("normal");
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [aiError, setAiError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [limitInfo, setLimitInfo] = useState<{ allowed: boolean; current: number; limit: number } | null>(null);

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    fetch("/api/assignments/limit").then((res) => res.json()).then((json) => {
      if (json.success) setLimitInfo(json.data);
    }).catch(() => {});
  }, []);

  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    const allowed = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "text/plain", "image/png", "image/jpeg", "image/webp"];
    const valid = Array.from(incoming).filter((f) => allowed.includes(f.type) && f.size <= 50 * 1024 * 1024);
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...valid.filter((f) => !names.has(f.name))];
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(index: number) { setFiles((prev) => prev.filter((_, i) => i !== index)); }
  function handleDrop(e: React.DragEvent) { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files); }

  async function handleAnalyse() {
    if (!description.trim() && files.length === 0) { setAiError("Please upload a file or write a description first."); return; }
    setAiError(""); setAnalysing(true);
    try {
      const formData = new FormData();
      formData.append("description", description);
      files.forEach((f) => formData.append("files", f));
      const res = await fetch("/api/ai/analyse", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) { setAiError(json.error ?? "Analysis failed."); return; }
      setAiResult(json.data as AIAnalysisResult);
    } catch { setAiError("Something went wrong. Check your connection and try again."); } 
    finally { setAnalysing(false); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!name.trim()) { setFormError("Please enter an assignment name."); return; }
    if (!deadline) { setFormError("Please set a deadline date."); return; }
    if (!aiResult) { setFormError("Please analyse the brief first so we can break it into tasks."); return; }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const { data: profile } = await supabase.from("profiles").select("timezone").eq("id", user.id).single();
      const userTimeZone = profile?.timezone ?? "Europe/London";
      const deadlineWithTime = toIsoWithTimezone(deadline, deadlineTime, userTimeZone);

      const res = await fetch("/api/assignments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined, deadline: deadlineWithTime, priority, sections: aiResult.sections, checklist: aiResult.checklist ?? [] }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { setFormError(json.error ?? "Failed to create assignment."); setSubmitting(false); return; }

      const assignmentId = json.data.id as string;
      await fetch("/api/schedule/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignmentId }) });
      router.push(`/dashboard/assignment/${assignmentId}`);
    } catch { setFormError("Something went wrong. Please try again."); } 
    finally { setSubmitting(false); }
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <header className="mb-8 border-b border-border pb-6">
        <h1 className="font-display text-2xl font-semibold text-text mb-2">New assignment</h1>
        <p className="text-muted text-sm">Upload your brief and let AI build a study plan around your schedule.</p>
      </header>

      {limitInfo && !limitInfo.allowed && (
        <div className="bg-amber/10 border border-amber/25 rounded-xl px-4 py-3 mb-8 text-sm" role="alert">
          <p className="text-text font-medium">You&apos;re at your plan&apos;s active assignment limit ({limitInfo.current}/{limitInfo.limit}).</p>
          <p className="text-muted text-xs mt-0.5">Archive an existing assignment, or <a href="/upgrade" className="text-indigo hover:underline font-medium">upgrade your plan</a> to add more.</p>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-8">
        
        <section aria-label="Provide the brief" className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-5">
          <header className="flex items-center justify-between border-b border-border pb-3">
            <h2 className="text-sm font-semibold text-text">1. Provide the brief</h2>
            {aiResult && <span className="text-xs font-medium text-green bg-green/10 px-2 py-0.5 rounded-full">Analysed</span>}
          </header>

          <fieldset className="space-y-4">
            <legend className="sr-only">Upload files or write description</legend>
            
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                isDragging || files.length > 0 ? "border-indigo bg-indigo/5" : "border-border hover:border-indigo/40 hover:bg-navy3/30"
              }`}
            >
              <input ref={fileInputRef} type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.png,.jpg,.jpeg,.webp" className="sr-only" onChange={(e) => addFiles(e.target.files)} aria-hidden="true" />
              <div className="text-indigo mb-3 flex justify-center"><UploadIcon /></div>
              <p className="text-text text-sm font-medium mb-1">{files.length > 0 ? `${files.length} file${files.length > 1 ? "s" : ""} selected` : "Upload files (PDF, DOCX, PPTX, image)"}</p>
              <p className="text-dim text-xs">or click anywhere to browse</p>
            </div>

            {files.length > 0 && (
              <ul className="space-y-2">
                {files.map((file, i) => (
                  <li key={file.name} className="flex items-center gap-3 bg-navy3/50 border border-border rounded-lg px-3 py-2">
                    <FileIcon className="text-indigo shrink-0" />
                    <span className="flex-1 truncate text-sm text-text font-medium">{file.name}</span>
                    <span className="text-dim text-xs shrink-0">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                    <button type="button" onClick={() => removeFile(i)} className="text-dim hover:text-red transition-colors shrink-0 p-1" aria-label="Remove file"><XIcon /></button>
                  </li>
                ))}
              </ul>
            )}

            <div className="relative">
              <div className="absolute inset-0 flex items-center" aria-hidden="true"><div className="w-full border-t border-border"></div></div>
              <div className="relative flex justify-center"><span className="bg-card px-3 text-xs font-medium text-dim uppercase tracking-wide">Or</span></div>
            </div>

            <div>
              <label htmlFor="description" className="block text-xs font-medium text-muted mb-1.5">Describe it yourself</label>
              <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={5000} className="w-full bg-card border border-border text-text placeholder-dim rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo transition-colors resize-none" placeholder="Paste the brief text here, or outline the requirements..." />
            </div>
          </fieldset>

          <div className="pt-2">
            <button type="button" onClick={handleAnalyse} disabled={analysing || (!description.trim() && files.length === 0)} className="w-full flex items-center justify-center gap-2 bg-navy3 border border-border hover:bg-navy hover:text-text text-muted font-medium rounded-lg px-4 py-2.5 text-sm transition-all disabled:opacity-50">
              {analysing ? <span className="w-4 h-4 border-2 border-muted border-t-text rounded-full animate-spin" /> : <SparklesIcon />}
              {aiResult ? "Re-analyse brief" : "Analyse brief"}
            </button>
            {aiError && <p className="text-red text-xs mt-2 text-center" role="alert">{aiError}</p>}
          </div>
        </section>

        {aiResult && (
          <section aria-label="AI Breakdown" className="bg-indigo/5 border border-indigo/20 rounded-xl overflow-hidden shadow-sm animate-in fade-in slide-in-from-top-2">
            <header className="bg-indigo/10 px-5 py-3 border-b border-indigo/10 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-indigo text-sm font-semibold"><SparklesIcon /> AI Breakdown</h2>
              <span className="text-indigo text-xs font-medium">~{aiResult.estimatedHours}h Total</span>
            </header>
            
            <div className="p-5 space-y-6">
              {aiResult.estimateAdjustment && (
                <p className="text-indigo/80 text-xs bg-indigo/5 p-3 rounded-lg border border-indigo/10">
                  Adjusted from initial ~{aiResult.estimateAdjustment.originalAiHours}h estimate based on {aiResult.estimateAdjustment.detail}.
                </p>
              )}

              <div>
                <h3 className="text-xs uppercase tracking-wider text-muted font-semibold mb-3">Proposed Sections ({aiResult.sections.length})</h3>
                <ul className="space-y-3">
                  {aiResult.sections.map((section, i) => (
                    <li key={i} className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 p-3 bg-card border border-border rounded-lg">
                      <article className="flex-1 min-w-0">
                        <h4 className="text-text text-sm font-medium">{section.name}</h4>
                        {section.description && <p className="text-dim text-xs mt-1 leading-relaxed">{section.description}</p>}
                      </article>
                      <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 shrink-0">
                        <span className="text-text text-sm font-medium bg-navy3 px-2 py-0.5 rounded-md border border-border">~{section.hours}h</span>
                        {section.confidence != null && <ConfidenceBar value={section.confidence} />}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              {aiResult.checklist && aiResult.checklist.length > 0 && (
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-muted font-semibold mb-3">Requirements Found</h3>
                  <ul className="grid sm:grid-cols-2 gap-2">
                    {aiResult.checklist.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-text bg-card border border-border p-2.5 rounded-lg">
                        <span className="text-green shrink-0 mt-0.5"><CheckIcon /></span>
                        <span className="leading-snug">{item.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}

        <section className={`bg-card border border-border rounded-xl p-5 shadow-sm space-y-5 transition-opacity duration-300 ${aiResult ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
          <header className="border-b border-border pb-3">
            <h2 className="text-sm font-semibold text-text">2. Schedule details</h2>
          </header>

          <fieldset className="space-y-5">
            <div>
              <label htmlFor="name" className="block text-xs font-medium text-muted mb-1.5">Assignment Name</label>
              <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required className="w-full bg-navy3 border border-border text-text placeholder-dim rounded-lg px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-indigo transition-colors" placeholder="e.g. History Midterm Essay" />
            </div>

            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <label htmlFor="deadline" className="block text-xs font-medium text-muted mb-1.5">Deadline Date</label>
                <input id="deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} min={today} required className="w-full bg-navy3 border border-border text-text rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo transition-colors" />
              </div>
              <div>
                <label htmlFor="deadline-time" className="block text-xs font-medium text-muted mb-1.5">Time</label>
                <input id="deadline-time" type="time" value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)} className="w-full bg-navy3 border border-border text-text rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo transition-colors" />
              </div>
            </div>

            <div role="group" aria-labelledby="priority-label">
              <span id="priority-label" className="block text-xs font-medium text-muted mb-2">Priority</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {PRIORITY_OPTIONS.map((opt) => (
                  <label key={opt.value} className={`flex items-center justify-center py-2.5 rounded-lg border text-sm font-medium cursor-pointer transition-all ${priority === opt.value ? `${opt.colour} bg-card shadow-sm` : "text-dim bg-navy3 border-border hover:bg-navy"}`}>
                    <input type="radio" name="priority" value={opt.value} checked={priority === opt.value} onChange={() => setPriority(opt.value)} className="sr-only" />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </fieldset>
        </section>

        {formError && <div className="bg-red/10 border border-red/20 rounded-xl px-4 py-3 text-red text-sm font-medium text-center" role="alert">{formError}</div>}

        <button type="submit" disabled={submitting || !aiResult} className="w-full flex items-center justify-center gap-2 bg-indigo hover:bg-indigo/90 text-white font-semibold rounded-xl py-3.5 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {submitting && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          {submitting ? "Generating Schedule..." : "Create Study Plan"}
        </button>
      </form>
    </main>
  );
}
