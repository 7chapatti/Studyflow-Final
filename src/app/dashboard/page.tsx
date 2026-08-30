import { redirect } from "next/navigation";
import { addDays, startOfWeek } from "date-fns";
import CalendarView from "@/components/calendar-view";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = addDays(weekStart, 6);

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

  return (
    <CalendarView
      initialWeekBase={now.toISOString()}
      initialBlocksRaw={blocksRaw ?? []}
      initialBlockedTimesRaw={btRaw ?? []}
      initialAssignments={asgnRaw ?? []}
    />
  );
}
