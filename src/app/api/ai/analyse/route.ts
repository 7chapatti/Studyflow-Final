// src/app/api/ai/analyse/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { requireAuth, checkAIQuota } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { calculatePaceRatio } from "@/lib/pace";
import type { AIAnalysisResult } from "@/types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const MAX_DESCRIPTION_CHARS = 5000;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_INPUT_CHARS = 18000;
const MAX_FILE_TEXT_CHARS = 12000;

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

function compressWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function hasHighRiskContent(input: string): boolean {
  const text = input.toLowerCase();

  const patterns = [
    /\bignore (all|any|previous) instructions\b/i,
    /\bprompt injection\b/i,
    /\bjailbreak\b/i,
    /\bhow to hack\b/i,
    /\bbypass (security|auth|login)\b/i,
    /\bphishing\b/i,
    /\bransomware\b/i,
    /\bmalware\b/i,
    /\bexfiltrat(e|ion)\b/i,
    /\bcredential(s)?\b/i,
    /\bweapon(s)?\b/i,
    /\bmake a bomb\b/i,
    /\bself[- ]harm\b/i,
  ];

  return patterns.some((pattern) => pattern.test(text));
}

function looksAcademic(input: string): boolean {
  const text = input.toLowerCase();
  return /assignment|essay|report|dissertation|lab report|presentation|coursework|module|referenc|bibliograph|word limit|deadline|question|task/i.test(text);
}

function printableRatio(input: string): number {
  if (!input) return 0;
  const printable = input.replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]/g, "");
  return printable.length / input.length;
}

async function extractFileText(file: File): Promise<{ name: string; text: string; note?: string }> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File too large: ${file.name}`);
  }

  const raw = await file.text();
  const cleaned = stripHtml(raw).replace(/\u0000/g, "");
  const ratio = printableRatio(cleaned);

  if (!cleaned.trim()) {
    return { name: file.name, text: "", note: "Empty or unreadable file" };
  }

  if (ratio < 0.6 && file.type !== "text/plain") {
    return {
      name: file.name,
      text: "",
      note: `Unreadable binary content (${file.type || "unknown type"})`,
    };
  }

  return {
    name: file.name,
    text: compressWhitespace(cleaned).slice(0, MAX_FILE_TEXT_CHARS),
  };
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { user, profile } = auth;

  const quota = await checkAIQuota(profile); // checkAIQuota is async — must await
  if (!quota.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: `You've used all ${quota.limit} AI analyses for this month. Upgrade your plan for more.`,
      },
      { status: 429 }
    );
  }

  const supabase = await createClient();
  const { data: paceLogRaw, error: paceLogError } = await supabase
    .from("pace_log")
    .select("estimated_hours, actual_hours")
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

  const paceRatio = calculatePaceRatio((paceLogRaw ?? []) as import("@/types").PaceLog[]);
  const paceActive = (paceLogRaw ?? []).length >= 5;

  let description = "";
  let files: File[] = [];

  try {
    const formData = await request.formData();
    description = ((formData.get("description") as string) ?? "").trim();
    files = formData.getAll("files") as File[];
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request." },
      { status: 400 }
    );
  }

  if (!description && files.length === 0) {
    return NextResponse.json(
      { success: false, error: "Provide a description or upload a file." },
      { status: 400 }
    );
  }

  if (description.length > MAX_DESCRIPTION_CHARS) {
    return NextResponse.json(
      { success: false, error: "Description too long." },
      { status: 400 }
    );
  }

  if (files.length > 5) {
    return NextResponse.json(
      { success: false, error: "Upload up to 5 files only." },
      { status: 400 }
    );
  }

  const safeDescription = compressWhitespace(stripHtml(description)).slice(
    0,
    MAX_DESCRIPTION_CHARS
  );

  let extractedFiles: Array<{ name: string; text: string; note?: string }> = [];
  try {
    extractedFiles = await Promise.all(files.map((file) => extractFileText(file)));
  } catch (err) {
    const message = err instanceof Error ? err.message : "File processing failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 }
    );
  }

  const combinedInput = compressWhitespace(
    [
      safeDescription,
      ...extractedFiles.map((f) => (f.text ? `${f.name}\n${f.text}` : `${f.name}${f.note ? ` (${f.note})` : ""}`)),
    ]
      .filter(Boolean)
      .join("\n\n")
  ).slice(0, MAX_TOTAL_INPUT_CHARS);

  if (hasHighRiskContent(combinedInput)) {
    return NextResponse.json(
      {
        success: false,
        error: "This content can't be processed. StudyFlow is for academic assignments only.",
      },
      { status: 400 }
    );
  }

  if (!looksAcademic(combinedInput)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "This doesn't look like an academic assignment. Please describe your coursework, essay, project, or study task.",
      },
      { status: 400 }
    );
  }

  const validationPrompt = `You are a content safety and academic relevance classifier for a university study planning app.

Return ONLY JSON:
{
  "isAcademic": true/false,
  "isSafe": true/false,
  "reason": "one sentence explanation"
}

Input:
"""${combinedInput}"""`;

  try {
    const validation = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: validationPrompt }],
      max_tokens: 120,
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const validationRaw = validation.choices[0]?.message?.content ?? "{}";
    const validationResult = JSON.parse(validationRaw);

    if (!validationResult?.isSafe) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This content can't be processed. StudyFlow is for academic assignments only.",
        },
        { status: 400 }
      );
    }

    if (!validationResult?.isAcademic) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This doesn't look like an academic assignment. Please describe your coursework, essay, project, or study task.",
        },
        { status: 400 }
      );
    }
  } catch (err) {
    console.error("Validation model error:", err);
    return NextResponse.json(
      {
        success: false,
        error: "Could not validate this brief right now. Please try again.",
      },
      { status: 503 }
    );
  }

  const prompt = `You are an expert university academic assignment planner.

Your job:
- break the assignment into actual deliverables the student must produce
- extract checklist items such as word counts, reference style, submission rules, and formatting requirements
- estimate the total work realistically
- do NOT invent requirements that are not present

Task rules:
- TASKS = actual content to write, solve, implement, or create
- CHECKLIST = submission requirements, formatting rules, citation style, word limits
- do not include studying, reading, or generic planning tasks as deliverables

Calibration:
- 1500 word essay: 2.5-4h total
- 2000 word essay: 3-5h total
- 3000 word essay: 5-7h total
- 5 question maths set: 3-6h total

Confidence:
- 0.9-1.0: specific and clear
- 0.7-0.85: mostly clear
- 0.5-0.65: vague
- 0.3-0.49: minimal info

${paceActive
    ? `PACE ADJUSTMENT: This student works at ${Math.round(paceRatio * 100)}% of average pace (ratio: ${paceRatio.toFixed(2)}). Multiply ALL hour estimates by ${paceRatio.toFixed(2)}.`
    : ""}

Return ONLY valid compact JSON:
{
  "estimatedHours": <number>,
  "sections": [
    {
      "name": "<specific deliverable section>",
      "hours": <number>,
      "confidence": <0.0-1.0>,
      "description": "<one sentence>"
    }
  ],
  "checklist": [
    {
      "category": "<word_limit|references|formatting|sections|submission|other>",
      "label": "<human readable requirement>",
      "detail": "<exact wording if available>",
      "confidence": <0.5-1.0>
    }
  ]
}

Assignment description:
"""${safeDescription || "(see uploaded files)"}"""

${extractedFiles.length > 0
    ? `Uploaded files:
${extractedFiles
  .map((f) => `- ${f.name}${f.note ? ` (${f.note})` : ""}${f.text ? `\n${f.text}` : ""}`)
  .join("\n\n")}`
    : ""}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1500,
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    let parsed: AIAnalysisResult;

    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "AI returned an unexpected response. Please try again.",
        },
        { status: 500 }
      );
    }

    if (!parsed.estimatedHours || !Array.isArray(parsed.sections)) {
      return NextResponse.json(
        {
          success: false,
          error: "AI response was incomplete. Please try again.",
        },
        { status: 500 }
      );
    }

    parsed.sections = parsed.sections.slice(0, 10).map((s) => ({
      ...s,
      hours: Math.max(0.25, Math.min(24, s.hours)),
      confidence: Math.max(0, Math.min(1, s.confidence ?? 0.7)),
      description: compressWhitespace(s.description ?? "").slice(0, 500),
      name: compressWhitespace(s.name ?? "").slice(0, 200),
    }));

    parsed.estimatedHours =
      Math.round(parsed.sections.reduce((sum, s) => sum + s.hours, 0) * 10) / 10;

    parsed.checklist = (parsed.checklist ?? []).slice(0, 15).map((item) => ({
      ...item,
      category: item.category ?? "other",
      label: compressWhitespace(item.label ?? "").slice(0, 300),
      detail: item.detail ? compressWhitespace(item.detail).slice(0, 500) : undefined,
      confidence: Math.max(0, Math.min(1, item.confidence ?? 0.7)),
    }));

    const { error: quotaUpdateError } = await supabase
      .from("profiles")
      .update({ ai_analyses_used: quota.used + 1 })
      .eq("id", user.id);

    if (quotaUpdateError) {
      console.error("Quota update error:", quotaUpdateError);
      return NextResponse.json(
        {
          success: false,
          error: "Analysis completed, but quota could not be updated. Please try again.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: parsed });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("OpenAI error:", message);
    return NextResponse.json(
      { success: false, error: "AI analysis failed. Please try again." },
      { status: 500 }
    );
  }
}
