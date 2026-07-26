"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { AIAnalysisResult, Priority } from "@/types";
import { TIER_LIMITS } from "@/types";

function UploadIcon() {
  return <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>;
}
function SparklesIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3L13.5 8.5L19 10L13.5 11.5L12 17L10.5 11.5L5 10L10.5 8.5L12 3Z"/><path d="M5 3L5.5 5L7 5.5L5.5 6L5 8L4.5 6L3 5.5L4.5 5L5 3Z"/><path d="M19 14L19.5 16L21 16.5L19.5 17L19 19L18.5 17L17 16.5L18.5 16L19 14Z"/></svg>;
}
function XIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
}
function FileIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>;
}
function CheckIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>;
}

function toIsoWithTimezone(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desiredLocalEpochMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const guessUtcMs = desiredLocalEpochMs;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(guessUtcMs));

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const actualLocalEpochMs = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  const offsetMs = actualLocalEpochMs - desiredLocalEpochMs;
  return new Date(guessUtcMs - offsetMs).toISOString();
}

const PRIORITY_OPTIONS: { value: Priority; label: string; colour: string }[] = [
  { value: "low",    label: "Low",    colour: "text-dim border-border" },
  { value: "normal", label: "Normal", colour: "text-muted border-border" },
  { value: "high",   label: "High",   colour: "text-amber border-amber/40" },
  { value: "urgent", label: "Urgent", colour: "text-red border-red/40" },
];

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const colour = pct >= 80 ? "bg-green" : pct >= 60 ? "bg-amber" : "bg-red";
  return (
    <span className="flex items-center gap-1.5 shrink-0" title={`Confidence: ${pct}%`}>
      <span className="text-xs text-dim">{pct}%</span>
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

  const today = new Date().toISOString().split("T")[0];

  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    const allowed = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
      "image/png",
      "image/jpeg",
      "image/webp",
    ];
    const valid = Array.from(incoming).filter(
      (f) => allowed.includes(f.type) && f.size <= 50 * 1024 * 1024
    );
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...valid.filter((f) => !names.has(f.name))];
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  }

  async function handleAnalyse() {
    if (!description.trim() && files.length === 0) {
      setAiError("Add a description or upload a file first.");
      return;
    }
    setAiError("");
    setAnalysing(true);
    try {
      const formData = new FormData();
      formData.append("description", description);
      files.forEach((f) => formData.append("files", f));
      const res = await fetch("/api/ai/analyse", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) { setAiError(json.error ?? "Analysis failed."); return; }
      setAiResult(json.data as AIAnalysisResult);
    } catch {
      setAiError("Something went wrong. Check your connection and try again.");
    } finally {
      setAnalysing(false);
    }
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

      const { data: profile } = await supabase
        .from("profiles").select("tier, timezone").eq("id", user.id).single();
      const tier = (profile?.tier ?? "free") as keyof typeof TIER_LIMITS;
      const limit = TIER_LIMITS[tier].activeAssignments;

      const { count } = await supabase
        .from("assignments")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "active");

      if ((count ?? 0) >= limit) {
        setFormError(`You've reached the ${limit} active assignment limit on your ${tier} plan. Archive completed assignments to add more.`);
        setSubmitting(false);
        return;
      }

      const { count: totalCount } = await supabase
        .from("assignments")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);

      const colourIndex = (totalCount ?? 0) % 6;

      const userTimeZone = profile?.timezone ?? "Europe/London";
      const deadlineWithTime = toIsoWithTimezone(deadline, deadlineTime, userTimeZone);

      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .insert({
          user_id: user.id,
          name: name.trim(),
          description: description.trim() || null,
          deadline: deadlineWithTime,
          priority,
          estimated_hours: aiResult.estimatedHours,
          colour_index: colourIndex,
          status: "active",
        })
        .select()
        .single();

      if (assignmentError || !assignment) {
        setFormError("Failed to create assignment. Please try again.");
        setSubmitting(false);
        return;
      }

      if (aiResult.sections.length > 0) {
        await supabase.from("tasks").insert(
          aiResult.sections.map((s, i) => ({
            assignment_id: assignment.id,
            name: s.name,
            description: s.description || null,
            estimated_hours: s.hours,
            confidence_score: s.confidence,
            order_index: i,
            status: "todo",
          }))
        );
      }

      if (aiResult.checklist && aiResult.checklist.length > 0) {
        await supabase.from("assignment_checklist").insert(
          aiResult.checklist.map((item) => ({
            assignment_id: assignment.id,
            category: item.category,
            label: item.label,
            detail: item.detail || null,
            confidence: item.confidence,
            checked: false,
          }))
        );
      }

      await fetch("/api/schedule/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: assignment.id }),
      });

      router.push(`/dashboard/assignment/${assignment.id}`);
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="font-sora text-2xl font-semibold text-text mb-1">New assignment</h1>
        <p className="text-muted text-sm">
          Describe your assignment and let StudyFlow build a plan around your schedule.
        </p>
      </header>

      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {/* File upload */}
        <section aria-labelledby="upload-heading">
          <h2 id="upload-heading" className="text-xs font-medium text-il mb-2">
            Upload brief{" "}
            <span className="text-dim font-normal">(optional — PDF, DOCX, PPTX, TXT, image)</span>
          </h2>
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload brief files — click or drop files here"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
              isDragging || files.length > 0
                ? "border-indigo bg-indigo/5"
                : "border-border hover:border-indigo/50 hover:bg-indigo/[0.02]"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.png,.jpg,.jpeg,.webp"
              className="sr-only"
              onChange={(e) => addFiles(e.target.files)}
              aria-hidden="true"
            />
            <p className="text-il mb-3 flex justify-center"><UploadIcon /></p>
            <p className="text-text text-sm font-medium mb-1">
              {files.length > 0
                ? `${files.length} file${files.length > 1 ? "s" : ""} selected — click to add more`
                : "Drop your brief here"}
            </p>
            <p className="text-dim text-xs">or click anywhere in this box to browse</p>
          </div>

          {files.length > 0 && (
            <ul className="mt-2 space-y-1.5" aria-label="Selected files">
              {files.map((file, i) => (
                <li key={file.name} className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2">
                  <span className="text-il shrink-0"><FileIcon /></span>
                  <span className="flex-1 truncate text-sm text-muted">{file.name}</span>
                  <span className="text-dim text-xs shrink-0">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="text-dim hover:text-red transition-colors shrink-0 p-0.5 rounded"
                    aria-label={`Remove ${file.name}`}
                  >
                    <XIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Description */}
        <section aria-labelledby="desc-heading">
          <label id="desc-heading" htmlFor="description" className="block text-xs font-medium text-il mb-1.5">
            Assignment description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={5000}
            className="w-full bg-navy3 border border-border text-text placeholder-dim rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo transition-colors resize-none leading-relaxed"
            placeholder="Describe what this assignment involves..."
          />
          <p className="text-right text-xs text-dim mt-1" aria-live="polite">
            {description.length} / 5000
          </p>
        </section>

        {/* Analyse button */}
        <div>
          <button
            type="button"
            onClick={handleAnalyse}
            disabled={analysing || (!description.trim() && files.length === 0)}
            className="flex items-center gap-2 bg-indigo/15 border border-indigo/30 hover:bg-indigo/25 text-il font-medium rounded-lg px-4 py-2.5 text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {analysing ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-il/30 border-t-il rounded-full animate-spin" aria-hidden="true" />
                Analysing…
              </>
            ) : (
              <>
                <SparklesIcon />
                {aiResult ? "Re-analyse" : "Analyse brief"}
              </>
            )}
          </button>
          {aiError && <p role="alert" className="text-red text-xs mt-2">{aiError}</p>}
        </div>

        {/* AI result */}
        {aiResult && (
          <section aria-labelledby="ai-heading" className="bg-indigo/[0.07] border border-indigo/20 rounded-xl p-5 space-y-4">
            <h2 id="ai-heading" className="flex items-center gap-2 text-il text-sm font-medium">
              <SparklesIcon />
              AI breakdown
            </h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-dim text-xs">Total estimate</dt>
                <dd className="text-text font-medium">~{aiResult.estimatedHours}h</dd>
              </div>
              <div>
                <dt className="text-dim text-xs">Sections</dt>
                <dd className="text-text font-medium">{aiResult.sections.length}</dd>
              </div>
            </dl>

            <section aria-labelledby="sections-heading">
              <h3 id="sections-heading" className="text-xs text-dim font-medium mb-2 uppercase tracking-wider">
                Proposed sections
              </h3>
              <ul className="space-y-2">
                {aiResult.sections.map((section, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 py-2 border-b border-indigo/10 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-text text-sm font-medium leading-snug">{section.name}</p>
                      {section.description && (
                        <p className="text-dim text-xs mt-0.5 leading-relaxed">{section.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-muted text-xs">~{section.hours}h</span>
                      {section.confidence != null && <ConfidenceBar value={section.confidence} />}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {aiResult.checklist && aiResult.checklist.length > 0 && (
              <section aria-labelledby="checklist-heading">
                <h3 id="checklist-heading" className="text-xs text-dim font-medium mb-2 uppercase tracking-wider">
                  Requirements found ({aiResult.checklist.length})
                </h3>
                <ul className="space-y-1.5">
                  {aiResult.checklist.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted">
                      <span className="text-green mt-0.5 shrink-0"><CheckIcon /></span>
                      <span>{item.label}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </section>
        )}

        {/* Assignment details */}
        <section aria-labelledby="details-heading" className="space-y-4">
          <h2 id="details-heading" className="text-xs font-medium text-il uppercase tracking-wider">
            Assignment details
          </h2>

          {/* Name */}
          <div className="space-y-1.5">
            <label htmlFor="name" className="block text-xs font-medium text-il">
              Assignment name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
              className="w-full bg-navy3 border border-border text-text placeholder-dim rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo transition-colors"
              placeholder="Give your assignment a name"
            />
          </div>

          {/* Deadline date + time side by side */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="deadline" className="block text-xs font-medium text-il">
                Deadline date
              </label>
              <input
                id="deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                min={today}
                required
                className="w-full bg-navy3 border border-border text-text rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="deadline-time" className="block text-xs font-medium text-il">
                Submission time
              </label>
              <input
                id="deadline-time"
                type="time"
                value={deadlineTime}
                onChange={(e) => setDeadlineTime(e.target.value)}
                className="w-full bg-navy3 border border-border text-text rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo transition-colors"
              />
            </div>
          </div>

          {/* Priority */}
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-il">Priority</legend>
            <div className="grid grid-cols-4 gap-1.5">
              {PRIORITY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center justify-center py-2 rounded-lg border text-xs font-medium cursor-pointer transition-all ${
                    priority === opt.value
                      ? `${opt.colour} bg-indigo/10`
                      : "text-dim border-border hover:border-border/80"
                  }`}
                >
                  <input
                    type="radio"
                    name="priority"
                    value={opt.value}
                    checked={priority === opt.value}
                    onChange={() => setPriority(opt.value)}
                    className="sr-only"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        {formError && (
          <p role="alert" className="text-red text-sm bg-red/10 border border-red/20 rounded-lg px-4 py-3">
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-indigo hover:bg-il text-white font-medium rounded-lg py-3 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Creating plan…" : "Create plan"}
        </button>
      </form>
    </div>
  );
}
