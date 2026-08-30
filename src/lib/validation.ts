
import { z } from "zod";

// ── Auth ──────────────────────────────────────────────────────────────────────

export const SignUpSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(80, "Name too long")
    .trim(),
  email: z.string().email("Invalid email address").toLowerCase().trim(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password too long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
});

export const LogInSchema = z.object({
  email: z.string().email("Invalid email address").toLowerCase().trim(),
  password: z.string().min(1, "Password required"),
});

// ── Assignment ────────────────────────────────────────────────────────────────

export const CreateAssignmentSchema = z.object({
  name: z
    .string()
    .min(1, "Assignment name required")
    .max(200, "Name too long")
    .trim(),
  description: z.string().max(5000, "Description too long").trim().optional(),
  deadline: z
    .string()
    .min(1, "Deadline required")
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: "Invalid deadline datetime",
    }),
  priority: z.enum(["low", "normal", "high", "urgent"]),
});

export const UpdateAssignmentSchema = CreateAssignmentSchema.partial().extend({
  status: z.enum(["active", "complete", "archived"]).optional(),
});

// Full payload for creating an assignment together with its AI-derived plan.
// Used server-side (POST /api/assignments) so the tasks/checklist that get
// written are re-validated rather than trusted verbatim from the client.
const AssignmentSectionSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  hours: z.number().min(0.25).max(24),
  confidence: z.number().min(0).max(1).optional(),
  description: z.string().max(500).trim().optional(),
});

const AssignmentChecklistItemSchema = z.object({
  category: z.enum(["word_limit", "references", "formatting", "sections", "submission", "other"]),
  label: z.string().min(1).max(300).trim(),
  detail: z.string().max(500).trim().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const CreateAssignmentWithPlanSchema = CreateAssignmentSchema.extend({
  sections: z.array(AssignmentSectionSchema).max(10).default([]),
  checklist: z.array(AssignmentChecklistItemSchema).max(15).default([]),
});

// ── Task ──────────────────────────────────────────────────────────────────────

export const UpdateTaskSchema = z.object({
  status: z.enum(["todo", "in_progress", "done", "missed"]).optional(),
  actual_hours: z.number().min(0).max(24).optional(),
  started_at: z.string().datetime().nullable().optional(),
  completed_at: z.string().datetime().nullable().optional(),
});

// ── Checklist ─────────────────────────────────────────────────────────────────

export const UpdateChecklistItemSchema = z.object({
  checked: z.boolean(),
});

// ── Blocked times ─────────────────────────────────────────────────────────────

export const BlockedTimeSchema = z
  .object({
    label: z
      .string()
      .min(1, "Label required")
      .max(40, "Label too long")
      .trim(),
    days: z
      .array(z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]))
      .min(1, "Select at least one day"),
    start_hour: z.number().min(0).max(23.75),
    end_hour: z.number().min(0.25).max(24),
    repeat_weekly: z.boolean(),
  })
  .refine((data) => data.end_hour > data.start_hour, {
    message: "End time must be after start time",
    path: ["end_hour"],
  });

// ── AI analysis ───────────────────────────────────────────────────────────────

export const AnalyseSchema = z.object({
  assignmentId: z.string().uuid(),
  description: z.string().max(5000).trim().optional(),
  fileKeys: z.array(z.string().max(200)).max(5).optional(),
});

// ── File upload ───────────────────────────────────────────────────────────────

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];
