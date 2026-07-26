// src/lib/api.ts
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function err(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function requireAuth() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { user: null, profile: null, error: err("Unauthorised", 401) };
  }

  const serviceSupabase = createServiceClient();
  const { data: profile, error: profileError } = await serviceSupabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    console.error("Profile fetch error:", profileError);
    return { user: null, profile: null, error: err("Profile not found", 404) };
  }

  return {
    user: { id: user.id, email: user.email as string },
    profile: profile as Profile,
    error: null,
  };
}

const ACTIVE_LIMITS: Record<string, number> = {
  free: 2,
  premium: 20,
  pro: 100,
};

export async function checkAssignmentLimit(userId: string, tier: string) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active");
  const current = count ?? 0;
  const limit = ACTIVE_LIMITS[tier] ?? 2;
  return { allowed: current < limit, current, limit };
}

const AI_LIMITS: Record<string, number> = {
  free: 3,
  premium: 50,
  pro: 200,
};

export async function checkAIQuota(profile: Profile) {
  const resetAt = new Date(profile.ai_analyses_reset_at);
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const limit = AI_LIMITS[profile.tier] ?? 3;
  const supabase = await createClient();

  if (Date.now() - resetAt.getTime() > thirtyDaysMs) {
    const { error } = await supabase
      .from("profiles")
      .update({
        ai_analyses_used: 0,
        ai_analyses_reset_at: new Date().toISOString(),
      })
      .eq("id", profile.id);

    if (error) {
      console.error("AI quota reset error:", error);
      throw error;
    }

    return { allowed: true, used: 0, limit };
  }

  const used = profile.ai_analyses_used;
  return { allowed: used < limit, used, limit };
}
