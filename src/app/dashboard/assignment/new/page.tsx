"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { AIAnalysisResult, Priority } from "@/types";
import { CheckIcon, FileIcon, SparklesIcon, UploadIcon, XIcon } from "@/components/icons";

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
        .from("profiles").select("timezone").eq("id", user.id).single();
      const userTimeZone = profile?.timezone ?? "Europe/London";
      const deadlineWithTime = toIsoWithTimezone(deadline, deadlineTime, userTimeZone);

      const res = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          deadline: deadlineWithTime,
          priority,
          sections: aiResult.sections,
          checklist: aiResult.checklist ?? [],
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setFormError(json.error ?? "Failed to create assignment. Please try again.");
        setSubmitting(false);
        return;
      }

      const assignmentId = json.data.id as string;

      await fetch("/api/schedule/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId }),
      });

      router.push(`/dashboard/assignment/${assignmentId}`);
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
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
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

            {/* Shown only when the deterministic word/question-count check
                disagreed with the AI's own total by enough to rescale it --
                most analyses won't show this. Transparent about what
                happened rather than silently swapping the number. */}
            {aiResult.estimateAdjustment && (
              <p className="text-dim text-xs -mt-1">
                Adjusted from the AI&rsquo;s initial ~{aiResult.estimateAdjustment.originalAiHours}h
                estimate based on {aiResult.estimateAdjustment.detail}.
              </p>
            )}

            <section aria-labelledby="sections-heading">
              <h3 id="sections-heading" className="text-xs text-dim font-medium mb-2 uppercase tracking-wider">
                Proposed sections
              </h3>
              <ul className="space-y-2">
                {/* aiResult is swapped as a whole on every re-analysis (never
                    spliced in place), so a plain index key would have been
                    safe here too -- this just avoids the code-smell. */}
                {aiResult.sections.map((section, i) => (
                  <li key={`${section.name}-${i}`} className="flex items-start justify-between gap-3 py-2 border-b border-indigo/10 last:border-0">
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
                    <li key={`${item.label}-${i}`} className="flex items-start gap-2 text-xs text-muted">
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
