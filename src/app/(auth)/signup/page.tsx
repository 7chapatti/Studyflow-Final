"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SignUpSchema } from "@/lib/validation";

export default function SignupPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const result = SignUpSchema.safeParse({ name, email, password });
    if (!result.success) {
        const fieldErrors: Record<string, string> = {};
        result.error.issues.forEach((issue) => {
            const field = issue.path[0] as string;
            fieldErrors[field] = issue.message;
    });
    setErrors(fieldErrors);
    return;
}

    setLoading(true);
    const supabase = createClient();

    const { error: authError } = await supabase.auth.signUp({
      email: result.data.email,
      password: result.data.password,
      options: {
        data: { name: result.data.name },
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });

    if (authError) {
      if (authError.message.toLowerCase().includes("already registered")) {
        setErrors({ email: "An account with this email already exists." });
      } else {
        setErrors({ form: "Something went wrong. Please try again." });
      }
      setLoading(false);
      return;
    }

    setDone(true);
  }

  if (done) {
    return (
      <div className="w-full max-w-sm">
        <div className="bg-card border border-border rounded-2xl p-8 text-center">
          <div className="w-14 h-14 bg-green/10 border border-green/25 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-6 h-6 text-green"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="font-sora text-xl font-semibold text-text mb-2">
            Check your email
          </h1>
          <p className="text-muted text-sm leading-relaxed">
            We sent a confirmation link to{" "}
            <span className="text-text">{email}</span>. Click it to activate
            your account and get started.
          </p>
          <p className="text-dim text-xs mt-4">
            Didn&apos;t receive it? Check your spam folder.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <div className="bg-card border border-border rounded-2xl p-8">
        <h1 className="font-sora text-2xl font-semibold text-text mb-1">
          Create your account
        </h1>
        <p className="text-muted text-sm mb-6">
          Free to start — no card required
        </p>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="name"
              className="block text-xs font-medium text-il"
            >
              Full name
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-navy3 border border-border text-text placeholder-dim rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo transition-colors"
              placeholder="Your name"
            />
            {errors.name && (
              <p role="alert" className="text-red text-xs">
                {errors.name}
              </p>
            )}
          </div>

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
            {errors.email && (
              <p role="alert" className="text-red text-xs">
                {errors.email}
              </p>
            )}
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
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-navy3 border border-border text-text placeholder-dim rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo transition-colors"
              placeholder="Min. 8 characters, one uppercase, one number"
            />
            {errors.password && (
              <p role="alert" className="text-red text-xs">
                {errors.password}
              </p>
            )}
          </div>

          {errors.form && (
            <p role="alert" className="text-red text-xs">
              {errors.form}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo hover:bg-il text-white font-medium rounded-lg py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="text-center text-muted text-sm mt-6">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-il hover:text-text transition-colors"
          >
            Log in
          </Link>
        </p>
      </div>

      <p className="text-center text-dim text-xs mt-4 px-4">
        By signing up you agree to our{" "}
        <Link href="/terms" className="underline hover:text-muted transition-colors">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline hover:text-muted transition-colors">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}