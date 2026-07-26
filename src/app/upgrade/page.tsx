"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types";
import Link from "next/link";

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
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

const FEATURES = [
  { label: "Active assignments", free: "2", premium: "20", pro: "100" },
  { label: "AI analyses per month", free: "3", premium: "50", pro: "200" },
  { label: "Max file size", free: "5 MB", premium: "25 MB", pro: "50 MB" },
  { label: "Storage", free: "50 MB", premium: "5 GB", pro: "20 GB" },
  { label: "Auto-scheduling", free: false, premium: true, pro: true },
  { label: "Auto-reschedule missed tasks", free: false, premium: true, pro: true },
  { label: "Google Calendar sync", free: false, premium: true, pro: true },
  { label: "Adaptive pace learning", free: false, premium: true, pro: true },
  { label: "Submission checklist", free: true, premium: true, pro: true },
  { label: "Progress tracking", free: true, premium: true, pro: true },
  { label: "Productivity insights", free: false, premium: false, pro: true },
  { label: "Confidence score breakdowns", free: false, premium: false, pro: true },
  { label: "Priority support", free: false, premium: false, pro: true },
];

export default function UpgradePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [yearly, setYearly] = useState(false);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const upgraded = searchParams.get("upgraded");

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const { data } = await supabase
        .from("profiles").select("*").eq("id", user.id).single();
      if (data) setProfile(data as Profile);
      setLoading(false);
    }
    load();
  }, [router]);

  async function handleUpgrade(tier: "premium" | "pro") {
    const plan = yearly ? `${tier}_yearly` : `${tier}_monthly`;
    setUpgrading(tier);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const json = await res.json();
      if (json.success && json.data.url) {
        window.location.href = json.data.url;
      } else {
        alert(json.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      alert("Something went wrong. Please try again.");
    } finally {
      setUpgrading(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-navy flex items-center justify-center">
        <span className="w-6 h-6 border-2 border-border border-t-il rounded-full animate-spin" />
      </div>
    );
  }

  const currentTier = profile?.tier ?? "free";

  const plans = [
    {
      key: "free" as const,
      name: "Free",
      monthlyPrice: "£0",
      yearlyPrice: "£0",
      description: "Everything you need to get started.",
      colour: "border-border",
      headerColour: "text-text",
      badge: null,
      canUpgrade: false,
      isCurrent: currentTier === "free",
    },
    {
      key: "premium" as const,
      name: "Premium",
      monthlyPrice: "£4.99",
      yearlyPrice: "£47.99",
      description: "For students juggling multiple assignments.",
      colour: "border-indigo",
      headerColour: "text-il",
      badge: "Most popular",
      canUpgrade: currentTier === "free",
      isCurrent: currentTier === "premium",
    },
    {
      key: "pro" as const,
      name: "Pro",
      monthlyPrice: "£9.99",
      yearlyPrice: "£95.99",
      description: "For power users who want everything.",
      colour: "border-border",
      headerColour: "text-text",
      badge: null,
      canUpgrade: currentTier === "free" || currentTier === "premium",
      isCurrent: currentTier === "pro",
    },
  ];

  return (
    <div className="min-h-screen bg-navy">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-border bg-navy/95 backdrop-blur-sm">
        <nav className="w-full px-6 h-14 flex items-center justify-between">
          <Link
            href="/dashboard"
            className="font-sora text-lg font-semibold text-text hover:text-il transition-colors"
          >
            Study<span className="text-il">Flow</span>
          </Link>
          <button
            onClick={() => router.push("/dashboard")}
            className="text-muted hover:text-text text-sm transition-colors flex items-center gap-1.5"
          >
            <XIcon />
            Close
          </button>
        </nav>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-12">
        {/* Success banner */}
        {upgraded && (
          <div className="bg-green/10 border border-green/25 rounded-xl px-5 py-4 mb-8 flex items-center gap-3">
            <span className="text-green"><CheckIcon /></span>
            <div>
              <p className="text-text text-sm font-medium">You&apos;re all set!</p>
              <p className="text-muted text-xs">Your plan has been upgraded successfully.</p>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="font-sora text-3xl font-semibold text-text mb-3">
            Choose your plan
          </h1>
          <p className="text-muted text-sm mb-6">
            Start free. Upgrade when you need more.
          </p>

          {/* Monthly / Yearly toggle */}
          <div className="inline-flex items-center gap-1 bg-card border border-border rounded-xl p-1.5">
            <button
              onClick={() => setYearly(false)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                !yearly ? "bg-indigo text-white" : "text-muted hover:text-text"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setYearly(true)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                yearly ? "bg-indigo text-white" : "text-muted hover:text-text"
              }`}
            >
              Yearly
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                yearly ? "bg-white/20 text-white" : "bg-green/15 text-green"
              }`}>
                Save 20%
              </span>
            </button>
          </div>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-12">
          {plans.map((plan) => {
            const displayPrice = yearly && plan.key !== "free"
              ? plan.yearlyPrice
              : plan.monthlyPrice;

            return (
              <div
                key={plan.key}
                className={`bg-card border-2 ${plan.colour} rounded-xl p-5 flex flex-col relative ${
                  plan.isCurrent ? "ring-2 ring-indigo/30" : ""
                }`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo text-white text-xs font-medium px-3 py-1 rounded-full whitespace-nowrap">
                    {plan.badge}
                  </div>
                )}
                {plan.isCurrent && (
                  <div className="absolute -top-3 right-4 bg-green text-navy text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">
                    Current
                  </div>
                )}

                <div className="mb-4">
                  <h2 className={`font-sora text-lg font-semibold mb-1 ${plan.headerColour}`}>
                    {plan.name}
                  </h2>
                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="font-sora text-3xl font-bold text-text">
                      {displayPrice}
                    </span>
                    {plan.key !== "free" && (
                      <span className="text-dim text-xs">
                        /{yearly ? "year" : "month"}
                      </span>
                    )}
                  </div>
                  {yearly && plan.key !== "free" && (
                    <p className="text-green text-xs font-medium">
                      Save 20% vs monthly billing
                    </p>
                  )}
                  {!yearly && plan.key !== "free" && (
                    <p className="text-dim text-xs">
                      Billed monthly · cancel anytime
                    </p>
                  )}
                  <p className="text-muted text-xs mt-2">{plan.description}</p>
                </div>

                <div className="flex-1" />

                {plan.isCurrent ? (
                  <div className="w-full text-center text-sm font-medium rounded-lg py-2.5 mt-4 bg-green/10 text-green border border-green/25">
                    Current plan
                  </div>
                ) : plan.canUpgrade ? (
                  <button
                    onClick={() => {
                      if (plan.key === "premium" || plan.key === "pro") {
                      handleUpgrade(plan.key);
                      }
                    }}
                    disabled={upgrading !== null}
                    className={`w-full text-center text-sm font-medium rounded-lg py-2.5 transition-colors mt-4 flex items-center justify-center gap-2 disabled:opacity-50 ${
                      plan.key === "premium"
                        ? "bg-indigo hover:bg-il text-white"
                        : "bg-navy3 border border-border hover:border-indigo/50 text-text"
                    }`}
                  >
                    {upgrading === plan.key && (
                      <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                    )}
                    Upgrade to {plan.name}
                  </button>
                ) : (
                  <div className="w-full text-center text-sm rounded-lg py-2.5 mt-4 text-dim">
                    {plan.key === "free" ? "Your starting point" : ""}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Feature comparison table */}
        <section aria-labelledby="compare-label">
          <h2
            id="compare-label"
            className="font-sora text-lg font-semibold text-text text-center mb-6"
          >
            Compare plans
          </h2>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-4 border-b border-border">
              <div className="p-4" />
              {["Free", "Premium", "Pro"].map((h) => (
                <div key={h} className="p-4 text-center">
                  <p className="font-sora text-sm font-semibold text-text">{h}</p>
                </div>
              ))}
            </div>

            {/* Feature rows */}
            {FEATURES.map((feature, i) => (
              <div
                key={feature.label}
                className={`grid grid-cols-4 ${
                  i < FEATURES.length - 1 ? "border-b border-border/50" : ""
                }`}
              >
                <div className="p-3 px-4">
                  <p className="text-sm text-muted">{feature.label}</p>
                </div>
                {(["free", "premium", "pro"] as const).map((tier) => {
                  const val = feature[tier];
                  return (
                    <div
                      key={tier}
                      className="p-3 flex items-center justify-center"
                    >
                      {typeof val === "boolean" ? (
                        val ? (
                          <span className="text-green"><CheckIcon /></span>
                        ) : (
                          <span className="text-border">
                            <XIcon />
                          </span>
                        )
                      ) : (
                        <span className="text-sm text-text font-medium">
                          {val}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        <p className="text-center text-dim text-xs mt-8">
          All plans include a 14-day money-back guarantee. Cancel anytime from your settings.
        </p>
      </main>
    </div>
  );
}