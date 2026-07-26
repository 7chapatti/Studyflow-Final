"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  format,
  startOfWeek,
  addDays,
  addWeeks,
  subWeeks,
  isSameDay,
  parseISO,
} from "date-fns";
import type { Assignment, Task } from "@/types";
import { COLOUR_PALETTE } from "@/types";

// ── Icons ─────────────────────────────────────────────────────────────────────

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
function WandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 4V2" /><path d="M15 16v-2" /><path d="M8 9h2" /><path d="M20 9h2" />
      <path d="M17.8 11.8 19 13" /><path d="M15 9h.01" /><path d="M17.8 6.2 19 5" />
      <path d="m3 21 9-9" /><path d="M12.2 6.2 11 5" />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" /><path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const ROW_HEIGHT = 48;
const GUTTER_WIDTH = 56;
const LONG_PRESS_MS = 500;
const DRAG_THRESHOLD_PX = 4;

// ── Types ─────────────────────────────────────────────────────────────────────

interface CalendarBlock {
  id: string;
  taskId: string;
  taskName: string;
  assignmentId: string;
  assignmentName: string;
  colourIndex: number;
  startTime: Date;
  endTime: Date;
  dayIndex: number;
  isPanic: boolean;
  type: "task";
}

interface CalendarBlockedTime {
  id: string;
  sourceId: string;
  label: string;
  startHour: number;
  endHour: number;
  dayIndex: number;
  type: "blocked";
}

type AnyBlock = CalendarBlock | CalendarBlockedTime;

interface DragState {
  blockId: string;
  blockType: "task" | "blocked";
  durationHours: number;
  grabOffsetHours: number;
  startX: number;
  startY: number;
  moved: boolean;
}

interface DropTarget {
  dayIndex: number;
  startHour: number;
  endHour: number;
  valid: boolean;
  reason: string;
}

interface ContextMenu {
  x: number;
  y: number;
  block: AnyBlock;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWeekStart(base: Date): Date {
  return startOfWeek(base, { weekStartsOn: 1 });
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function snapToHalfHour(hour: number): number {
  return Math.round(hour * 2) / 2;
}

function fmtHour(h: number): string {
  return `${pad(Math.floor(h))}:${pad(Math.round((h % 1) * 60))}`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const router = useRouter();
  const desktopGridRef = useRef<HTMLDivElement>(null);
  const mobileGridRef = useRef<HTMLDivElement>(null);

  const [weekBase, setWeekBase] = useState(() => new Date());
  const [activeDayIndex, setActiveDayIndex] = useState(() => {
    const d = new Date().getDay();
    return d === 0 ? 6 : d - 1;
  });

  const [taskBlocks, setTaskBlocks] = useState<CalendarBlock[]>([]);
  const [blockedTimes, setBlockedTimes] = useState<CalendarBlockedTime[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [rescheduling, setRescheduling] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [toast, setToast] = useState("");

  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const weekStart = getWeekStart(weekBase);
  const weekEnd = addDays(weekStart, 6);
  const weekDays = DAYS.map((_, i) => addDays(weekStart, i));
  const today = new Date();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }, []);

  // ── Load data ─────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const [{ data: blocksRaw }, { data: btRaw }, { data: asgnRaw }] =
      await Promise.all([
        supabase
          .from("scheduled_blocks")
          .select("*, task:tasks(name, status, assignment:assignments(id, name, colour_index))")
          .eq("user_id", user.id)
          .gte("start_time", weekStart.toISOString())
          .lte("end_time", addDays(weekEnd, 1).toISOString())
          .limit(200),
        supabase.from("blocked_times").select("*").eq("user_id", user.id),
        supabase.from("assignments").select("*").eq("user_id", user.id).eq("status", "active"),
      ]);

    // Map task blocks
    const calBlocks: CalendarBlock[] = [];
    for (const b of blocksRaw ?? []) {
      const task = b.task as unknown as Task & { assignment: Assignment };
      if (!task || task.status === "done") continue;
      const start = parseISO(b.start_time);
      const end = parseISO(b.end_time);
      let dayIndex = -1;
      for (let i = 0; i < 7; i++) {
        if (isSameDay(start, weekDays[i])) { dayIndex = i; break; }
      }
      if (dayIndex === -1) continue;
      calBlocks.push({
        id: b.id, taskId: b.task_id, taskName: task.name,
        assignmentId: task.assignment?.id ?? "",
        assignmentName: task.assignment?.name ?? "",
        colourIndex: task.assignment?.colour_index ?? 0,
        startTime: start, endTime: end, dayIndex,
        isPanic: b.is_panic ?? false,
        type: "task",
      });
    }
    setTaskBlocks(calBlocks);

    // Map blocked times — one display block per DB row per day, no merging
    const calBT: CalendarBlockedTime[] = [];
    for (const bt of btRaw ?? []) {
      for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        if ((bt.days as string[]).includes(DAYS[dayIdx])) {
          calBT.push({
            id: `${bt.id}-${dayIdx}`,
            sourceId: bt.id,
            label: bt.label,
            startHour: Number(bt.start_hour),
            endHour: Number(bt.end_hour),
            dayIndex: dayIdx,
            type: "blocked",
          });
        }
      }
    }
    setBlockedTimes(calBT);
    setAssignments((asgnRaw ?? []) as Assignment[]);
    setLoading(false);
  }, [weekStart.toISOString()]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { setEditMode(false); }, [weekBase]);

  // ── Coordinate helpers ────────────────────────────────────────────────────

  function getGridPos(clientX: number, clientY: number, isMobile: boolean) {
    const ref = isMobile ? mobileGridRef.current : desktopGridRef.current;
    if (!ref) return null;
    const rect = ref.getBoundingClientRect();
    const scrollTop = ref.scrollTop ?? 0;
    const relY = clientY - rect.top + scrollTop;
    const relX = clientX - rect.left - GUTTER_WIDTH;
    if (relY < 0 || relX < 0) return null;
    const hour = relY / ROW_HEIGHT;
    if (hour < 0 || hour > 24) return null;
    let dayIndex: number;
    if (isMobile) {
      dayIndex = activeDayIndex;
    } else {
      const colWidth = (rect.width - GUTTER_WIDTH) / 7;
      dayIndex = Math.floor(relX / colWidth);
      if (dayIndex < 0 || dayIndex > 6) return null;
    }
    return { dayIndex, hour };
  }

  // ── Validation ────────────────────────────────────────────────────────────

  function isInBlockedTime(dayIndex: number, s: number, e: number) {
    return blockedTimes.some(
      (bt) => bt.dayIndex === dayIndex && s < bt.endHour && e > bt.startHour
    );
  }

  function isOccupiedByTask(dayIndex: number, s: number, e: number, excludeId: string) {
    return taskBlocks.some((b) => {
      if (b.id === excludeId) return false;
      if (b.dayIndex !== dayIndex) return false;
      const bS = b.startTime.getHours() + b.startTime.getMinutes() / 60;
      const bE = b.endTime.getHours() + b.endTime.getMinutes() / 60;
      return s < bE && e > bS;
    });
  }

  function isOccupiedByBlocked(dayIndex: number, s: number, e: number, excludeId: string) {
    return blockedTimes.some((b) => {
      if (b.id === excludeId) return false;
      if (b.dayIndex !== dayIndex) return false;
      return s < b.endHour && e > b.startHour;
    });
  }

  // ── Drag ─────────────────────────────────────────────────────────────────

  function onPointerDown(e: React.MouseEvent | React.TouchEvent, block: AnyBlock, isMobile: boolean) {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();

    const clientX = "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    let startHour: number;
    let durationHours: number;

    if (block.type === "task") {
      startHour = block.startTime.getHours() + block.startTime.getMinutes() / 60;
      const endHour = block.endTime.getHours() + block.endTime.getMinutes() / 60;
      durationHours = endHour - startHour;
    } else {
      startHour = block.startHour;
      durationHours = block.endHour - block.startHour;
    }

    const pos = getGridPos(clientX, clientY, isMobile);
    const grabOffsetHours = pos
      ? Math.max(0, Math.min(pos.hour - startHour, durationHours - 0.25))
      : 0;

    const state: DragState = {
      blockId: block.id,
      blockType: block.type,
      durationHours,
      grabOffsetHours,
      startX: clientX,
      startY: clientY,
      moved: false,
    };

    dragRef.current = state;
    setDragging(state);
  }

  const onPointerMove = useCallback((e: MouseEvent | TouchEvent) => {
    const state = dragRef.current;
    if (!state) return;
    e.preventDefault();

    const clientX = "touches" in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : (e as MouseEvent).clientY;

    if (!state.moved) {
      const dx = Math.abs(clientX - state.startX);
      const dy = Math.abs(clientY - state.startY);
      if (dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) return;
      if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
      const next = { ...state, moved: true };
      dragRef.current = next;
      setDragging(next);
    }

    setGhostPos({ x: clientX, y: clientY });

    const isMobile = window.innerWidth < 640;
    const pos = getGridPos(clientX, clientY, isMobile);
    if (!pos) { setDropTarget(null); return; }

    const rawStart = pos.hour - state.grabOffsetHours;
    const snappedStart = snapToHalfHour(Math.max(0, rawStart));
    const snappedEnd = Math.min(24, snappedStart + state.durationHours);

    let valid = snappedEnd <= 24;
    let reason = "";

    if (state.blockType === "task") {
      // Tasks cannot go into blocked times or onto other tasks
      if (isInBlockedTime(pos.dayIndex, snappedStart, snappedEnd)) {
        valid = false; reason = "Blocked time";
      } else if (isOccupiedByTask(pos.dayIndex, snappedStart, snappedEnd, state.blockId)) {
        valid = false; reason = "Already taken";
      }
    } else {
      // Blocked times cannot go onto task blocks or other blocked times
      if (isOccupiedByTask(pos.dayIndex, snappedStart, snappedEnd, "")) {
        valid = false; reason = "Task block here";
      } else if (isOccupiedByBlocked(pos.dayIndex, snappedStart, snappedEnd, state.blockId)) {
        valid = false; reason = "Overlaps another blocked time";
      }
    }

    setDropTarget({ dayIndex: pos.dayIndex, startHour: snappedStart, endHour: snappedEnd, valid, reason });
  }, [taskBlocks, blockedTimes, activeDayIndex]);

  const onPointerUp = useCallback(async () => {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }

    const state = dragRef.current;
    const drop = dropTarget;

    dragRef.current = null;
    setDragging(null);
    setDropTarget(null);
    setGhostPos(null);

    if (!state || !state.moved || !drop) return;

    if (!drop.valid) {
      showToast(
        drop.reason === "Blocked time" ? "Can't place a task in a blocked time"
        : drop.reason === "Task block here" ? "Can't place a blocked time over a task"
        : drop.reason === "Overlaps another blocked time" ? "That slot overlaps another blocked time"
        : "That slot is already taken"
      );
      return;
    }

    const targetDay = weekDays[drop.dayIndex];
    const supabase = createClient();

    if (state.blockType === "task") {
      const newStart = new Date(targetDay);
      newStart.setHours(Math.floor(drop.startHour), Math.round((drop.startHour % 1) * 60), 0, 0);
      const newEnd = new Date(targetDay);
      newEnd.setHours(Math.floor(drop.endHour), Math.round((drop.endHour % 1) * 60), 0, 0);

      setTaskBlocks((prev) => prev.map((b) =>
        b.id === state.blockId
          ? { ...b, startTime: newStart, endTime: newEnd, dayIndex: drop.dayIndex }
          : b
      ));

      const { error } = await supabase
        .from("scheduled_blocks")
        .update({ start_time: newStart.toISOString(), end_time: newEnd.toISOString() })
        .eq("id", state.blockId);

      if (error) { showToast("Failed to save — please try again"); loadData(); }
      else showToast("✓ Task moved");

    } else {
      const bt = blockedTimes.find((b) => b.id === state.blockId);
      if (!bt) return;

      setBlockedTimes((prev) => prev.map((b) =>
        b.id === state.blockId
          ? { ...b, startHour: drop.startHour, endHour: drop.endHour, dayIndex: drop.dayIndex }
          : b
      ));

      const { error } = await supabase
        .from("blocked_times")
        .update({ start_hour: drop.startHour, end_hour: drop.endHour })
        .eq("id", bt.sourceId);

      if (error) { showToast("Failed to save — please try again"); loadData(); }
      else showToast("✓ Blocked time moved");
    }
  }, [dropTarget, weekDays, blockedTimes, showToast, loadData]);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("mousemove", onPointerMove, { passive: false });
    window.addEventListener("touchmove", onPointerMove, { passive: false });
    window.addEventListener("mouseup", onPointerUp);
    window.addEventListener("touchend", onPointerUp);
    return () => {
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("touchmove", onPointerMove);
      window.removeEventListener("mouseup", onPointerUp);
      window.removeEventListener("touchend", onPointerUp);
    };
  }, [dragging, onPointerMove, onPointerUp]);

  // ── Context menu ──────────────────────────────────────────────────────────

  function openCtx(e: React.MouseEvent | React.TouchEvent, block: AnyBlock) {
    e.preventDefault();
    e.stopPropagation();
    const clientX = "touches" in e
      ? e.changedTouches[0].clientX
      : (e as React.MouseEvent).clientX;
    const clientY = "touches" in e
      ? e.changedTouches[0].clientY
      : (e as React.MouseEvent).clientY;
    setContextMenu({ x: clientX, y: clientY, block });
  }

  function startLongPress(e: React.TouchEvent, block: AnyBlock) {
    longPressRef.current = setTimeout(() => openCtx(e, block), LONG_PRESS_MS);
  }

  function cancelLongPress() {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
  }

  async function deleteBlock(block: AnyBlock) {
    setContextMenu(null);
    const supabase = createClient();

    if (block.type === "task") {
      await supabase.from("scheduled_blocks").delete().eq("id", block.id);
      setTaskBlocks((prev) => prev.filter((b) => b.id !== block.id));
      showToast("Block removed — run Organise to reschedule");
    } else {
      const bt = block as CalendarBlockedTime;
      const thisDay = DAYS[block.dayIndex];
      const { data: original } = await supabase
        .from("blocked_times").select("days").eq("id", bt.sourceId).single();
      if (!original) return;
      const days = original.days as string[];
      if (days.length === 1) {
        await supabase.from("blocked_times").delete().eq("id", bt.sourceId);
      } else {
        await supabase.from("blocked_times")
          .update({ days: days.filter((d) => d !== thisDay) })
          .eq("id", bt.sourceId);
      }
      await loadData();
      showToast(`Removed ${bt.label} for ${thisDay}`);
    }
  }

  // ── Reschedule ────────────────────────────────────────────────────────────

  async function handleReschedule() {
    setRescheduling(true);
    try {
      const res = await fetch("/api/schedule/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.success) {
        await loadData();
        if (json.data.atRisk?.length > 0) {
          showToast(`⚠ "${json.data.atRisk[0].assignmentName}" may not finish before deadline.`);
        } else {
          showToast("✓ Tasks rescheduled around your blocked times");
        }
      }
    } catch {
      showToast("Reschedule failed. Please try again.");
    } finally {
      setRescheduling(false);
    }
  }

  // ── Block renderers ───────────────────────────────────────────────────────

  function renderTask(block: CalendarBlock, isMobile: boolean) {
    const colour = COLOUR_PALETTE[block.colourIndex % COLOUR_PALETTE.length];
    const sH = block.startTime.getHours() + block.startTime.getMinutes() / 60;
    const eH = block.endTime.getHours() + block.endTime.getMinutes() / 60;
    const top = sH * ROW_HEIGHT;
    const height = Math.max((eH - sH) * ROW_HEIGHT, 20);
    const isDragging = dragging?.blockId === block.id && dragging.moved;

    const bg = block.isPanic ? "rgba(248,113,113,0.2)" : colour.bg;
    const border = block.isPanic ? "#F87171" : colour.border;
    const textColour = block.isPanic ? "#FCA5A5" : colour.text;

    return (
      <button
        key={block.id}
        className={`absolute left-0.5 right-0.5 rounded-md px-1.5 py-1 text-left overflow-hidden z-10 select-none transition-opacity ${
          editMode ? "cursor-grab ring-1 ring-white/10" : "cursor-pointer hover:brightness-110"
        } ${isDragging ? "opacity-20" : "opacity-100"}`}
        style={{ top, height, background: bg, borderLeft: `3px solid ${border}` }}
        onMouseDown={editMode ? (e) => onPointerDown(e, block, isMobile) : undefined}
        onTouchStart={(e) => { if (editMode) onPointerDown(e, block, isMobile); startLongPress(e, block); }}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        onContextMenu={(e) => openCtx(e, block)}
        onClick={!editMode ? () => router.push(`/dashboard/assignment/${block.assignmentId}`) : undefined}
      >
        <p className="text-xs font-medium truncate leading-tight" style={{ color: textColour }}>
          {block.isPanic && "🔴 "}{block.taskName}
          {editMode && <span className="opacity-40"> ⠿</span>}
        </p>
        {height > 30 && (
          <p className="text-xs truncate opacity-70" style={{ color: textColour }}>
            {pad(block.startTime.getHours())}:{pad(block.startTime.getMinutes())}–
            {pad(block.endTime.getHours())}:{pad(block.endTime.getMinutes())}
          </p>
        )}
      </button>
    );
  }

  function renderBlocked(bt: CalendarBlockedTime, isMobile: boolean) {
    const top = bt.startHour * ROW_HEIGHT;
    const height = (bt.endHour - bt.startHour) * ROW_HEIGHT;
    const isDragging = dragging?.blockId === bt.id && dragging.moved;

    return (
      <div
        key={bt.id}
        className={`absolute left-0 right-0 border-l-2 select-none transition-opacity ${
          editMode
            ? "bg-border/30 border-indigo/40 cursor-grab"
            : "bg-border/20 border-border/50 pointer-events-none"
        } ${isDragging ? "opacity-20" : "opacity-100"}`}
        style={{ top, height }}
        onMouseDown={editMode ? (e) => onPointerDown(e as unknown as React.MouseEvent, bt, isMobile) : undefined}
        onTouchStart={(e) => { if (editMode) onPointerDown(e, bt, isMobile); startLongPress(e, bt); }}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        onContextMenu={(e) => openCtx(e as unknown as React.MouseEvent, bt)}
      >
        <span className="absolute top-1 left-2 text-xs text-dim font-medium truncate max-w-full pr-1">
          {bt.label}{editMode && <span className="opacity-40"> ⠿</span>}
        </span>
      </div>
    );
  }

  function renderDropPreview(dayIndex: number) {
    if (!dropTarget || dropTarget.dayIndex !== dayIndex || !dragging?.moved) return null;
    const top = dropTarget.startHour * ROW_HEIGHT;
    const height = Math.max((dropTarget.endHour - dropTarget.startHour) * ROW_HEIGHT, 20);
    return (
      <div
        className={`absolute left-0.5 right-0.5 rounded-md z-20 border-2 pointer-events-none ${
          dropTarget.valid ? "bg-green/20 border-green" : "bg-red/20 border-red"
        }`}
        style={{ top, height }}
      >
        <p className={`text-xs font-medium px-1.5 pt-1 truncate ${dropTarget.valid ? "text-green" : "text-red"}`}>
          {dropTarget.valid
            ? `${fmtHour(dropTarget.startHour)}–${fmtHour(dropTarget.endHour)}`
            : dropTarget.reason}
        </p>
      </div>
    );
  }

  function DayColumn({ dayIndex, isMobile }: { dayIndex: number; isMobile: boolean }) {
    return (
      <div className="relative border-r border-border/30 last:border-r-0 h-full">
        {blockedTimes.filter((bt) => bt.dayIndex === dayIndex).map((bt) => renderBlocked(bt, isMobile))}
        {taskBlocks.filter((b) => b.dayIndex === dayIndex).map((b) => renderTask(b, isMobile))}
        {renderDropPreview(dayIndex)}
      </div>
    );
  }

  function HourLines() {
    return (
      <>
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="absolute left-0 right-0 border-t border-border/30"
            style={{ top: `${hour * ROW_HEIGHT}px` }}
          >
            {hour > 0 && (
              <span
                className="absolute left-0 w-14 text-right pr-2 text-xs text-dim select-none"
                style={{ top: -10 }}
              >
                {pad(hour)}:00
              </span>
            )}
          </div>
        ))}
      </>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]" onClick={() => setContextMenu(null)}>

      {/* Drag ghost */}
      {dragging?.moved && ghostPos && dropTarget && (() => {
        const label = dragging.blockType === "task"
          ? (taskBlocks.find((b) => b.id === dragging.blockId)?.taskName ?? "")
          : (blockedTimes.find((b) => b.id === dragging.blockId)?.label ?? "");
        return (
          <div
            className="fixed z-50 pointer-events-none rounded-md px-1.5 py-1 shadow-xl opacity-80"
            style={{
              left: ghostPos.x + 10,
              top: ghostPos.y - dragging.grabOffsetHours * ROW_HEIGHT,
              width: 130,
              height: Math.max(dragging.durationHours * ROW_HEIGHT, 20),
              background: dropTarget.valid ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)",
              border: `2px solid ${dropTarget.valid ? "#4ade80" : "#f87171"}`,
            }}
          >
            <p className="text-xs font-medium truncate text-text">{label}</p>
          </div>
        );
      })()}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-card border border-border rounded-xl shadow-xl py-1 min-w-[190px]"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 210),
            top: Math.min(contextMenu.y, window.innerHeight - 160),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-xs text-dim px-3 py-1.5 border-b border-border truncate font-medium">
            {contextMenu.block.type === "task"
              ? (contextMenu.block as CalendarBlock).taskName
              : (contextMenu.block as CalendarBlockedTime).label}
          </p>
          {contextMenu.block.type === "task" && (
            <button
              onClick={() => {
                setContextMenu(null);
                router.push(`/dashboard/assignment/${(contextMenu.block as CalendarBlock).assignmentId}`);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted hover:text-text hover:bg-navy3 transition-colors text-left"
            >
              <CheckIcon />
              Go to assignment
            </button>
          )}
          {contextMenu.block.type === "blocked" && (
            <button
              onClick={() => { setContextMenu(null); router.push("/dashboard/blocked"); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted hover:text-text hover:bg-navy3 transition-colors text-left"
            >
              <PencilIcon />
              Edit blocked times
            </button>
          )}
          <button
            onClick={() => deleteBlock(contextMenu.block)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red hover:bg-red/10 transition-colors text-left"
          >
            <TrashIcon />
            {contextMenu.block.type === "task"
              ? "Remove this block"
              : `Remove for ${DAYS[contextMenu.block.dayIndex]}`}
          </button>
          <button
            onClick={() => setContextMenu(null)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-dim hover:text-text hover:bg-navy3 transition-colors text-left"
          >
            <XIcon />
            Cancel
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setWeekBase((d) => subWeeks(d, 1))}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-muted hover:text-text hover:border-indigo/50 transition-all"
              aria-label="Previous week"
            >
              <ChevronLeftIcon />
            </button>
            <button
              onClick={() => setWeekBase(() => new Date())}
              className="px-3 h-8 text-xs font-medium text-muted border border-border rounded-lg hover:text-text hover:border-indigo/50 transition-all"
            >
              Today
            </button>
            <button
              onClick={() => setWeekBase((d) => addWeeks(d, 1))}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-muted hover:text-text hover:border-indigo/50 transition-all"
              aria-label="Next week"
            >
              <ChevronRightIcon />
            </button>
          </div>
          <h1 className="font-sora text-sm font-semibold text-text hidden sm:block">
            {format(weekStart, "d MMM")} – {format(weekEnd, "d MMM yyyy")}
          </h1>
          <h1 className="font-sora text-sm font-semibold text-text sm:hidden">
            {format(weekDays[activeDayIndex], "EEE d MMM")}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditMode((e) => !e)}
            className={`flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 transition-all border ${
              editMode
                ? "bg-amber/10 text-amber border-amber/40 hover:bg-amber/20"
                : "text-muted border-border hover:text-il hover:border-indigo/50"
            }`}
          >
            {editMode ? <CheckIcon /> : <PencilIcon />}
            {editMode ? "Done" : "Edit"}
          </button>
          <button
            onClick={handleReschedule}
            disabled={rescheduling}
            className="flex items-center gap-1.5 text-xs font-medium text-muted border border-border hover:text-il hover:border-indigo/50 rounded-lg px-3 py-1.5 transition-all disabled:opacity-50"
          >
            {rescheduling
              ? <span className="w-3 h-3 border border-muted border-t-il rounded-full animate-spin" />
              : <WandIcon />}
            Organise
          </button>
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 text-xs font-medium text-muted border border-border hover:text-il hover:border-indigo/50 rounded-lg px-3 py-1.5 transition-all"
            aria-label="Refresh"
          >
            <RefreshIcon />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Edit hint */}
      {editMode && (
        <div className="px-4 py-2 bg-amber/5 border-b border-amber/20 text-amber text-xs flex items-center gap-2 shrink-0">
          <PencilIcon />
          Drag blocks to move them. Right-click or long-press for more options.
          Green = valid slot, red = taken or blocked.
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="w-6 h-6 border-2 border-border border-t-il rounded-full animate-spin" aria-label="Loading" />
        </div>
      ) : (
        <>
          {/* ── DESKTOP ──────────────────────────────────────────────────── */}
          <div className="hidden sm:flex flex-col flex-1 overflow-auto">
            <div className="min-w-[640px]">
              <div
                className="grid sticky top-0 z-10 bg-navy border-b border-border"
                style={{ gridTemplateColumns: `${GUTTER_WIDTH}px repeat(7, 1fr)` }}
              >
                <div className="border-r border-border" />
                {weekDays.map((day, i) => {
                  const isToday = isSameDay(day, today);
                  return (
                    <div key={i} className={`text-center py-2 border-r border-border last:border-r-0 ${isToday ? "bg-indigo/10" : ""}`}>
                      <p className={`text-xs font-medium uppercase tracking-wider ${isToday ? "text-il" : "text-dim"}`}>{DAYS[i]}</p>
                      <p className={`font-sora text-lg font-semibold leading-tight ${isToday ? "text-il" : "text-text"}`}>{format(day, "d")}</p>
                    </div>
                  );
                })}
              </div>

              <div ref={desktopGridRef} className="relative" style={{ height: `${24 * ROW_HEIGHT}px` }}>
                <HourLines />
                <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `${GUTTER_WIDTH}px repeat(7, 1fr)` }}>
                  <div className="border-r border-border" />
                  {weekDays.map((_, dayIdx) => (
                    <DayColumn key={dayIdx} dayIndex={dayIdx} isMobile={false} />
                  ))}
                </div>
                {weekDays.some((d) => isSameDay(d, today)) && (
                  <div
                    className="absolute border-t-2 border-red z-20 pointer-events-none"
                    style={{
                      left: `${GUTTER_WIDTH}px`, right: 0,
                      top: `${(today.getHours() + today.getMinutes() / 60) * ROW_HEIGHT}px`,
                    }}
                  >
                    <div className="w-2 h-2 rounded-full bg-red -translate-y-1 -translate-x-1" />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── MOBILE ───────────────────────────────────────────────────── */}
          <div className="flex sm:hidden flex-col flex-1 overflow-hidden">
            <div className="flex border-b border-border shrink-0">
              {weekDays.map((day, i) => {
                const isToday = isSameDay(day, today);
                const isActive = i === activeDayIndex;
                const hasBlocks = taskBlocks.some((b) => b.dayIndex === i);
                return (
                  <button
                    key={i}
                    onClick={() => setActiveDayIndex(i)}
                    className={`flex-1 min-w-[44px] py-2 text-center transition-all border-b-2 ${
                      isActive ? "border-indigo bg-indigo/10" : "border-transparent hover:bg-indigo/5"
                    }`}
                  >
                    <p className={`text-xs font-medium uppercase ${isToday ? "text-il" : isActive ? "text-il" : "text-dim"}`}>
                      {DAYS[i].charAt(0)}
                    </p>
                    <p className={`font-sora text-base font-semibold ${isToday ? "text-il" : isActive ? "text-text" : "text-muted"}`}>
                      {format(day, "d")}
                    </p>
                    {hasBlocks && (
                      <div className={`w-1 h-1 rounded-full mx-auto mt-0.5 ${isActive ? "bg-il" : "bg-dim"}`} />
                    )}
                  </button>
                );
              })}
            </div>

            <div ref={mobileGridRef} className="flex-1 overflow-auto">
              <div className="relative" style={{ height: `${24 * ROW_HEIGHT}px` }}>
                <HourLines />
                <div className="absolute inset-0" style={{ paddingLeft: `${GUTTER_WIDTH}px` }}>
                  <DayColumn dayIndex={activeDayIndex} isMobile={true} />
                </div>
                {isSameDay(weekDays[activeDayIndex], today) && (
                  <div
                    className="absolute border-t-2 border-red z-20 pointer-events-none"
                    style={{
                      left: `${GUTTER_WIDTH}px`, right: 0,
                      top: `${(today.getHours() + today.getMinutes() / 60) * ROW_HEIGHT}px`,
                    }}
                  >
                    <div className="w-2 h-2 rounded-full bg-red -translate-y-1 -translate-x-1" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Legend */}
      {assignments.length > 0 && (
        <div className="shrink-0 px-4 py-2 border-t border-border flex flex-wrap gap-4">
          {assignments.map((asgn) => {
            const colour = COLOUR_PALETTE[asgn.colour_index % COLOUR_PALETTE.length];
            return (
              <button
                key={asgn.id}
                onClick={() => router.push(`/dashboard/assignment/${asgn.id}`)}
                className="flex items-center gap-1.5 text-xs text-muted hover:text-text transition-colors"
              >
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: colour.border }} />
                <span className="truncate max-w-[120px]">{asgn.name}</span>
              </button>
            );
          })}
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0 bg-border/60 border border-border" />
            Blocked
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0 bg-red/40 border border-red/50" />
            Urgent
          </span>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-card border border-indigo text-text text-sm px-4 py-2.5 rounded-xl shadow-lg z-50 max-w-sm text-center"
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}
    </div>
  );
}