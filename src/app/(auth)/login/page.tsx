"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogInSchema } from "@/lib/validation";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // Validate inputs
    const result = LogInSchema.safeParse({ email, password });
    if (!result.success) {
        setError(result.error.issues[0].message);
        return;
    }

    setLoading(true);
    const supabase = createClient();

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: result.data.email,
      password: result.data.password,
    });

    if (authError) {
      // Don't reveal whether email exists — generic message
      setError("Invalid email or password.");
      setLoading(false);
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm">
      <div className="bg-card border border-border rounded-2xl p-8">
        <h1 className="font-sora text-2xl font-semibold text-text mb-1">
          Welcome back
        </h1>
        <p className="text-muted text-sm mb-6">
          Sign in to access your study planner
        </p>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="email"
              className="block text-xs font-medium text-il"
            >
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-navy3 border border-border text-text placeholder-dim rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo transition-colors"
              placeholder="your@email.com"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="password"
              className="block text-xs font-medium text-il"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-navy3 border border-border text-text placeholder-dim rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo transition-colors"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p role="alert" className="text-red text-xs">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo hover:bg-il text-white font-medium rounded-lg py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Signing in…" : "Log in"}
          </button>
        </form>

        <p className="text-center text-muted text-sm mt-6">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="text-il hover:text-text transition-colors"
          >
            Sign up free
          </Link>
        </p>
      </div>
    </div>
  );
}