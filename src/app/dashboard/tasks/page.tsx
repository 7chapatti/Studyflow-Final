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

      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          router.replace("/login");
          return;
        }

        const { data, error: queryError } = await supabase
          .from("assignments")
          .select("*, tasks(*)")
          .eq("user_id", user.id)
          .eq("status", filter)
          .order("deadline", { ascending: true });

        if (cancelled) return;

        if (queryError) {
          setAssignments([]);
          setError("Failed to load assignments.");
          return;
        }

        const nextAssignments = (data ?? []).map((assignment) => ({
          ...(assignment as AssignmentWithTasks),
          tasks: [...((assignment as AssignmentWithTasks).tasks ?? [])].sort(
            (a, b) => a.order_index - b.order_index
          ),
        }));

        setAssignments(nextAssignments);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setLoading(true);
    load();

    return () => {
      cancelled = true;
    };
  }, [filter, router]);

  const filterTabs: { value: typeof filter; label: string }[] = [
    { value: "active", label: "Active" },
    { value: "complete", label: "Completed" },
    { value: "archived", label: "Archived" },
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <header className="flex items-center justify-between mb-6">
        <h1 className="font-sora text-2xl font-semibold text-text">My tasks</h1>
        <Link
          href="/dashboard/assignment/new"
          className="flex items-center gap-1.5 bg-indigo hover:bg-il text-white text-sm font-medium rounded-lg px-3 py-2 transition-colors"
        >
          <PlusIcon size={15} />
          New assignment
        </Link>
      </header>

      <div className="flex gap-1 bg-navy3 rounded-lg p-1 mb-6 w-fit">
        {filterTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              filter === tab.value
                ? "bg-card text-text shadow-sm"
                : "text-muted hover:text-text"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <span className="w-5 h-5 border-2 border-border border-t-il rounded-full animate-spin" aria-label="Loading" />
        </div>
      ) : error ? (
        <p className="text-red text-sm">{error}</p>
      ) : assignments.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted text-sm mb-2">
            {filter === "active"
              ? "No active assignments yet."
              : filter === "complete"
              ? "No completed assignments yet."
              : "No archived assignments."}
          </p>
          {filter === "active" && (
            <Link
              href="/dashboard/assignment/new"
              className="text-il text-sm hover:underline"
            >
              Add your first assignment →
            </Link>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {assignments.map((asgn) => {
            const colour = COLOUR_PALETTE[asgn.colour_index % COLOUR_PALETTE.length];
            const done = asgn.tasks.filter((t) => t.status === "done").length;
            const total = asgn.tasks.length;
            const progress = total > 0 ? Math.round((done / total) * 100) : 0;
            const dueDate = new Date(asgn.deadline).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            });
            const daysLeft = Math.ceil(
              (new Date(asgn.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            );
            const isOverdue = daysLeft < 0 && asgn.status === "active";
            const isDueSoon = daysLeft <= 3 && daysLeft >= 0 && asgn.status === "active";

            return (
              <li key={asgn.id}>
                <Link
                  href={`/dashboard/assignment/${asgn.id}`}
                  className="block bg-card border border-border hover:border-indigo/50 rounded-xl p-4 transition-all group"
                  style={{ borderLeft: `3px solid ${colour.border}` }}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <h2 className="text-text text-sm font-medium font-sora truncate group-hover:text-il transition-colors">
                        {asgn.name}
                      </h2>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="flex items-center gap-1 text-xs text-muted">
                          <CalendarIcon size={12} />
                          {dueDate}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-muted">
                          <ClockIcon size={12} />
                          ~{asgn.estimated_hours}h
                        </span>
                        {isOverdue && (
                          <span className="text-xs text-red font-medium">Overdue</span>
                        )}
                        {isDueSoon && (
                          <span className="text-xs text-amber font-medium">
                            Due in {daysLeft === 0 ? "today" : `${daysLeft}d`}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted">{progress}%</span>
                      <ChevronRightIcon size={14} />
                    </div>
                  </div>

                  <div className="h-1.5 bg-navy3 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${progress}%`, background: colour.border }}
                    />
                  </div>

                  <p className="text-dim text-xs mt-1.5">
                    {done} of {total} sections done
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
