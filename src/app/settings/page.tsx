"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types";
import { TIER_LIMITS } from "@/types";

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function ZapIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

const TIER_INFO = {
  free: {
    label: "Free",
    colour: "text-muted",
    features: [
      "2 active assignments",
      "3 AI analyses per month",
      "5 MB max file size",
      "Basic progress tracking",
    ],
  },
  premium: {
    label: "Premium",
    colour: "text-amber",
    features: [
      "20 active assignments",
      "50 AI analyses per month",
      "25 MB max file size",
      "Auto-scheduling & rescheduling",
      "Google Calendar sync",
      "Adaptive pace learning",
    ],
  },
  pro: {
    label: "Pro",
    colour: "text-il",
    features: [
      "100 active assignments",
      "200 AI analyses per month",
      "50 MB max file size",
      "Everything in Premium",
      "Productivity insights",
      "Confidence score breakdowns",
    ],
  },
} as const;

export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSuccess, setNameSuccess] = useState(false);
  const [nameError, setNameError] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwError, setPwError] = useState("");

  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          router.replace("/login");
          return;
        }

        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();

        if (!mounted) return;

        if (error || !data) {
          router.replace("/login");
          return;
        }

        setProfile(data as Profile);
        setName(data.name);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, [router]);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setNameError("");
    setNameSuccess(false);

    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 2) {
      setNameError("Name must be at least 2 characters.");
      return;
    }

    setNameSaving(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const { error } = await supabase
        .from("profiles")
        .update({ name: trimmed })
        .eq("id", user.id);

      if (error) {
        setNameError("Failed to save. Please try again.");
        return;
      }

      setNameSuccess(true);
      setProfile((p) => (p ? { ...p, name: trimmed } : p));
    } finally {
      setNameSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError("");
    setPwSuccess(false);

    if (!newPassword) {
      setPwError("Please enter a new password.");
      return;
    }
    if (newPassword.length < 8) {
      setPwError("Password must be at least 8 characters.");
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      setPwError("Password must contain at least one uppercase letter.");
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setPwError("Password must contain at least one number.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("Passwords do not match.");
      return;
    }

    setPwSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });

      if (error) {
        setPwError(error.message);
        return;
      }

      setPwSuccess(true);
      setNewPassword("");
      setConfirmPassword("");
    } finally {
      setPwSaving(false);
    }
  }

  async function handleDeleteAccount() {
    setDeleteError("");

    if (deleteConfirm !== "DELETE") {
      setDeleteError("Type DELETE in capitals to confirm.");
      return;
    }

    const confirmed = confirm(
      "This will permanently delete your account, assignments, tasks, blocked times, and schedule. Continue?"
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });

      let json: { success?: boolean; error?: string } | null = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }

      if (!res.ok || !json?.success) {
        setDeleteError(json?.error ?? "Failed to delete account.");
        return;
      }

      const supabase = createClient();
      await supabase.auth.signOut();
      router.replace("/signup");
    } catch {
      setDeleteError("Failed to delete account.");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="w-6 h-6 border-2 border-border border-t-il rounded-full animate-spin" aria-label="Loading" />
      </div>
    );
  }

  if (!profile) return null;

  const tierInfo = TIER_INFO[profile.tier as keyof typeof TIER_INFO];
  const limits = TIER_LIMITS[profile.tier as keyof typeof TIER_LIMITS];
  const aiResetDate = new Date(profile.ai_analyses_reset_at);
  aiResetDate.setDate(aiResetDate.getDate() + 30);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-sora text-2xl font-semibold text-text mb-1">Settings</h1>
          <p className="text-muted text-sm">Manage your account and preferences.</p>
        </div>
        <button
          onClick={() => router.push("/dashboard")}
          className="flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted hover:text-text hover:border-indigo/50 transition-all shrink-0 mt-1"
          aria-label="Go back"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      <section aria-labelledby="profile-label" className="bg-card border border-border rounded-xl p-5">
        <h2 id="profile-label" className="flex items-center gap-2 font-sora text-base font-semibold text-text mb-4">
          <span className="text-il"><UserIcon /></span>
          Profile
        </h2>
        <form onSubmit={handleSaveName} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="name" className="block text-xs font-medium text-il">
              Display name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameSuccess(false);
              }}
              maxLength={80}
              className="w-full bg-navy3 border border-border text-text placeholder-dim rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo transition-colors"
            />
          </div>
          {nameError && <p role="alert" className="text-red text-xs">{nameError}</p>}
          {nameSuccess && (
            <p className="text-green text-xs flex items-center gap-1">
              <CheckIcon /> Name updated successfully.
            </p>
          )}
          <button
            type="submit"
            disabled={nameSaving}
            className="bg-indigo hover:bg-il text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
          >
            {nameSaving ? "Saving…" : "Save name"}
          </button>
        </form>
      </section>

      <section aria-labelledby="security-label" className="bg-card border border-border rounded-xl p-5">
        <h2 id="security-label" className="flex items-center gap-2 font-sora text-base font-semibold text-text mb-4">
          <span className="text-il"><ShieldIcon /></span>
          Security
        </h2>
        <form onSubmit={handleChangePassword} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="new-pw" className="block text-xs font-medium text-il">
              New password
            </label>
            <input
              id="new-pw"
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setPwSuccess(false);
              }}
              autoComplete="new-password"
              placeholder="Min. 8 characters, one uppercase, one number"
              className="w-full bg-navy3 border border-border text-text placeholder-dim rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo transition-colors"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="confirm-pw" className="block text-xs font-medium text-il">
              Confirm new password
            </label>
            <input
              id="confirm-pw"
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setPwSuccess(false);
              }}
              autoComplete="new-password"
              placeholder="Repeat new password"
              className="w-full bg-navy3 border border-border text-text placeholder-dim rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo transition-colors"
            />
          </div>
          {pwError && <p role="alert" className="text-red text-xs">{pwError}</p>}
          {pwSuccess && (
            <p className="text-green text-xs flex items-center gap-1">
              <CheckIcon /> Password changed successfully.
            </p>
          )}
          <button
            type="submit"
            disabled={pwSaving}
            className="bg-indigo hover:bg-il text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
          >
            {pwSaving ? "Updating…" : "Update password"}
          </button>
        </form>
      </section>

      <section aria-labelledby="plan-label" className="bg-card border border-border rounded-xl p-5">
        <h2 id="plan-label" className="flex items-center gap-2 font-sora text-base font-semibold text-text mb-4">
          <span className="text-il"><ZapIcon /></span>
          Your plan
        </h2>

        <div className="flex items-center gap-3 mb-4">
          <span className={`font-sora text-xl font-semibold ${tierInfo.colour}`}>
            {tierInfo.label}
          </span>
          {profile.tier === "free" && (
            <span className="text-xs text-dim border border-border rounded-full px-2 py-0.5">
              Free forever
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 mb-5">
          <div className="bg-navy3 rounded-lg p-3">
            <p className="text-xs text-dim mb-1">AI analyses this month</p>
            <p className="text-text font-semibold text-lg">
              {profile.ai_analyses_used}
              <span className="text-dim font-normal text-sm"> / {limits.aiAnalysesPerMonth}</span>
            </p>
            <p className="text-xs text-dim mt-1">
              Resets {aiResetDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </p>
          </div>
          <div className="bg-navy3 rounded-lg p-3">
            <p className="text-xs text-dim mb-1">Storage used</p>
            <p className="text-text font-semibold text-lg">
              {(profile.storage_used_bytes / 1024 / 1024).toFixed(1)}
              <span className="text-dim font-normal text-sm">
                {" "}MB / {limits.totalStorageMB >= 1000
                  ? `${limits.totalStorageMB / 1000} GB`
                  : `${limits.totalStorageMB} MB`}
              </span>
            </p>
          </div>
        </div>

        <ul className="space-y-2 mb-5">
          {tierInfo.features.map((f) => (
            <li key={f} className="flex items-center gap-2 text-sm text-muted">
              <span className="text-green shrink-0"><CheckIcon /></span>
              {f}
            </li>
          ))}
        </ul>

        {profile.tier !== "pro" && (
          <div className="bg-indigo/10 border border-indigo/25 rounded-xl p-4">
            <p className="text-text text-sm font-medium mb-1">
              {profile.tier === "free" ? "Upgrade your plan" : "Upgrade to Pro"}
            </p>
            <p className="text-muted text-xs mb-3 leading-relaxed">
              {profile.tier === "free"
                ? "Get more assignments, more AI analyses, and automatic scheduling."
                : "Get 100 active assignments, 200 AI analyses, and productivity insights."}
            </p>
            <Link
              href="/upgrade"
              className="inline-block bg-indigo hover:bg-il text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
            >
              View plans →
            </Link>
          </div>
        )}
      </section>

      <section aria-labelledby="danger-label" className="bg-card border border-red/20 rounded-xl p-5">
        <h2 id="danger-label" className="font-sora text-base font-semibold text-red mb-2">
          Danger zone
        </h2>
        <p className="text-muted text-sm mb-4">
          Deleting your account is permanent. All assignments, tasks, and data will be removed immediately.
        </p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="delete-confirm" className="block text-xs font-medium text-muted">
              Type <strong className="text-text">DELETE</strong> to confirm
            </label>
            <input
              id="delete-confirm"
              type="text"
              value={deleteConfirm}
              onChange={(e) => {
                setDeleteConfirm(e.target.value);
                setDeleteError("");
              }}
              placeholder="DELETE"
              className="w-full bg-navy3 border border-border text-text placeholder-dim rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-red transition-colors max-w-xs"
            />
          </div>
          {deleteError && <p role="alert" className="text-red text-xs">{deleteError}</p>}
          <button
            onClick={handleDeleteAccount}
            disabled={deleting}
            className="bg-red/10 hover:bg-red/20 border border-red/30 text-red text-sm font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete my account"}
          </button>
        </div>
      </section>
    </div>
  );
}
