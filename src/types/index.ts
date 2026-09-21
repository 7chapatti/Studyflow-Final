export type Tier = "free" | "premium" | "pro";
export type Priority = "low" | "normal" | "high" | "urgent";
export type AssignmentStatus = "active" | "complete" | "archived";
export type TaskStatus = "todo" | "in_progress" | "done" | "missed";
export type ChecklistCategory =
  | "word_limit"
  | "references"
  | "formatting"
  | "sections"
  | "submission"
  | "other";

export interface Profile {
  id: string;
  name: string;
  tier: Tier;
  ai_analyses_used: number;
  ai_analyses_reset_at: string;
  storage_used_bytes: number;
  google_calendar_connected: boolean;
  timezone: string;
  stripe_customer_id: string | null;
  created_at: string;
}

export interface Assignment {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  deadline: string;
  priority: Priority;
  estimated_hours: number;
  colour_index: number;
  status: AssignmentStatus;
  archived_at: string | null;
  created_at: string;
  tasks?: Task[];
  checklist?: ChecklistItem[];
}

export interface Task {
  id: string;
  assignment_id: string;
  name: string;
  description: string | null;
  estimated_hours: number;
  confidence_score: number | null;
  actual_hours: number | null;
  status: TaskStatus;
  started_at: string | null;
  completed_at: string | null;
  order_index: number;
  created_at: string;
}

export interface ChecklistItem {
  id: string;
  assignment_id: string;
  category: ChecklistCategory;
  label: string;
  detail: string | null;
  confidence: number | null;
  checked: boolean;
  created_at: string;
}

export interface ScheduledBlock {
  id: string;
  user_id: string;
  task_id: string;
  start_time: string;
  end_time: string;
  google_event_id: string | null;
  is_missed: boolean;
  created_at: string;
  task?: Task & { assignment?: Assignment };
}

export interface BlockedTime {
  id: string;
  user_id: string;
  label: string;
  days: string[];
  start_hour: number; 
  end_hour: number;
  repeat_weekly: boolean;
  created_at: string;
}

export interface PaceLog {
  id: string;
  user_id: string;
  task_id: string;
  estimated_hours: number;
  actual_hours: number;
  logged_at: string;
}

export interface TimeSlot {
  start: Date;
  end: Date;
  weight: number; 
}

export interface ScheduledBlockInsert {
  user_id: string;
  task_id: string;
  start_time: string;
  end_time: string;
}

export interface AISection {
  name: string;
  hours: number;
  confidence: number;
  description: string;
}

export interface AIChecklistItem {
  category: ChecklistCategory;
  label: string;
  detail?: string;
  confidence: number;
}

export interface AIAnalysisResult {
  estimatedHours: number;
  sections: AISection[];
  checklist: AIChecklistItem[];
  estimateAdjustment?: {
    ruleBasedHours: number;
    basis: "word_count" | "question_count";
    detail: string;
    originalAiHours: number;
  };
}

export const TIER_LIMITS = {
  free: {
    activeAssignments: 2,
    aiAnalysesPerMonth: 3,
    maxFileSizeMB: 5,
    totalStorageMB: 50,
  },
  premium: {
    activeAssignments: 20,
    aiAnalysesPerMonth: 50,
    maxFileSizeMB: 25,
    totalStorageMB: 5000,
  },
  pro: {
    activeAssignments: 100,
    aiAnalysesPerMonth: 200,
    maxFileSizeMB: 50,
    totalStorageMB: 20000,
  },
} as const;

export const COLOUR_PALETTE = [
  { bg: "#386C9C", border: "#386C9C", text: "#F7F9F6" }, 
  { bg: "#467A43", border: "#467A43", text: "#F7F9F6" }, 
  { bg: "#6E5FA3", border: "#6E5FA3", text: "#F7F9F6" }, 
  { bg: "#86661A", border: "#86661A", text: "#F7F9F6" }, 
  { bg: "#2B7774", border: "#2B7774", text: "#F7F9F6" }, 
  { bg: "#A4506F", border: "#A4506F", text: "#F7F9F6" }, 
] as const;

export const DUE_SOON_COLOUR = {
  bg: "#B5402F",
  border: "#B5402F",
  text: "#F7F9F6",
} as const;

export const DAYS_OF_WEEK = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];
