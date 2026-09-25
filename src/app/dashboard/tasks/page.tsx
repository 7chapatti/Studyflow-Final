"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Assignment, Task } from "@/types";
import { COLOUR_PALETTE } from "@/types";
import { CalendarIcon, ChevronRightIcon, ClockIcon, PlusIcon } from "@/components/icons";

interface AssignmentWithTasks extends Assignment {
  tasks: Task[];
}

export default function TasksPage() {
  const router = useRouter();
  const [assignments, setAssignments] = useState<AssignmentWithTasks[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"active" | "complete" | "archived">("active");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError("");
      setLoading(true);
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.replace("/login"); return; }

        const { data, error: queryError } = await supabase
          .from("assignments")
          .select("*, tasks(*)")
          .eq("user_id", user.id)
          .eq("status", filter)
          .order("deadline", { ascending: true });

        if (cancelled) return;
        if (queryError) { setError("Failed to load assignments."); return; }

        const nextAssignments = (data ?? []).map((assignment) => ({
          ...(assignment as AssignmentWithTasks),
          tasks: [...((assignment as AssignmentWithTasks).tasks ?? [])].sort((a, b) => a.order_index - b.order_index),
        }));
        setAssignments(nextAssignments);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [filter, router]);

  const filterTabs: { value: typeof filter; label: string }[] = [
    { value: "active", label: "Active" },
    { value: "complete", label: "Completed" },
    { value: "archived", label: "Archived" },
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <header className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl font-semibold text-text">My tasks</h1>
        <Link
          href="/dashboard/assignment/new"
          className="flex items-center gap-1.5 bg-indigo hover:bg-indigo/90 text-white shadow-sm text-sm font-medium rounded-lg px-4 py-2 transition-all"
        >
          <PlusIcon size={15} />
          New assignment
        </Link>
      </header>

      {/* Segmented Control */}
      <div className="flex bg-navy3/50 rounded-lg p-1 mb-8 w-fit border border-border">
        {filterTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`px-5 py-1.5 rounded-md text-sm font-medium transition-all ${
              filter === tab.value
                ? "bg-card text-text shadow-sm border border-border/50"
                : "text-muted hover:text-text hover:bg-card/50 border border-transparent"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <span className="w-6 h-6 border-2 border-border border-t-indigo rounded-full animate-spin" aria-label="Loading" />
        </div>
      ) : error ? (
        <div className="p-4 bg-red/10 border border-red/20 rounded-xl text-red text-sm">{error}</div>
      ) : assignments.length === 0 ? (
        <div className="text-center py-16 bg-card border border-dashed border-border rounded-xl">
          <p className="text-muted text-sm mb-3">
            {filter === "active" ? "No active assignments yet." : filter === "complete" ? "No completed assignments yet." : "No archived assignments."}
          </p>
          {filter === "active" && (
            <Link href="/dashboard/assignment/new" className="text-indigo text-sm font-medium hover:underline">
              Add your first assignment →
            </Link>
          )}
        </div>
      ) : (
        <ul className="space-y-4">
          {assignments.map((asgn) => {
            const colour = COLOUR_PALETTE[asgn.colour_index % COLOUR_PALETTE.length];
            const done = asgn.tasks.filter((t) => t.status === "done").length;
            const total = asgn.tasks.length;
            const progress = total > 0 ? Math.round((done / total) * 100) : 0;
            const dueDate = new Date(asgn.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
            const daysLeft = Math.ceil((new Date(asgn.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            const isOverdue = daysLeft < 0 && asgn.status === "active";
            const isDueSoon = daysLeft <= 3 && daysLeft >= 0 && asgn.status === "active";

            return (
              <li key={asgn.id}>
                <Link
                  href={`/dashboard/assignment/${asgn.id}`}
                  className="block bg-card border border-border hover:border-indigo/40 hover:shadow-sm rounded-xl p-5 transition-all group relative overflow-hidden"
                >
                  <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: colour.border }} />
                  <div className="pl-2">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="flex-1 min-w-0">
                        <h2 className="text-text text-base font-semibold font-display truncate group-hover:text-indigo transition-colors">
                          {asgn.name}
                        </h2>
                        <div className="flex items-center gap-4 mt-2 flex-wrap">
                          <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
                            <CalendarIcon size={13} /> {dueDate}
                          </span>
                          <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
                            <ClockIcon size={13} /> ~{asgn.estimated_hours}h
                          </span>
                          {isOverdue && <span className="text-[11px] uppercase tracking-wider text-red font-bold bg-red/10 px-2 py-0.5 rounded-full">Overdue</span>}
                          {isDueSoon && <span className="text-[11px] uppercase tracking-wider text-amber font-bold bg-amber/10 px-2 py-0.5 rounded-full">Due in {daysLeft === 0 ? "today" : `${daysLeft}d`}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 text-muted group-hover:text-indigo transition-colors">
                        <span className="text-sm font-medium">{progress}%</span>
                        <ChevronRightIcon size={16} />
                      </div>
                    </div>

                    <div className="h-2 bg-navy3/50 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, background: colour.border }} />
                    </div>
                    <p className="text-dim text-xs mt-2 font-medium">
                      {done} of {total} sections completed
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
