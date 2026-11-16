"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { safeRedirectPath } from "@/lib/redirect";
import {
  POST_AUTH_COOKIE,
  POST_AUTH_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/auth-redirect-cookie";

// Shared by the login and signup pages. Supabase handles the Google OAuth
// exchange itself; this only starts it and says where to come back to.
//
// Text-only on purpose: Google's sign-in branding guidelines expect their
// official "G" mark on this button. Download it from Google's branding
// page and add it here rather than redrawing it.
export default function GoogleSignInButton({
  label,
  next,
}: {
  label: string;
  next?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleClick() {
    setError("");
    setLoading(true);

    const destination = safeRedirectPath(next);
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${POST_AUTH_COOKIE}=${encodeURIComponent(destination)}; Path=/; Max-Age=${POST_AUTH_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });

    // On success the browser is already navigating to Google, so there is
    // nothing more to do here. Only a failure to start leaves us on the page.
    if (authError) {
      setError("Couldn't start Google sign-in. Please try again.");
      setLoading(false);
    }
  }

  // Off until the Google provider has been switched on in Supabase. Without
  // that, pressing the button lands on a raw Supabase error page, so it
  // stays hidden (along with its "or" divider) rather than ship broken.
  if (process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED !== "true") return null;

  return (
    <>
      <p className="my-4 text-center text-xs text-dim">or</p>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="w-full bg-navy3 border border-border hover:border-indigo/50 text-text font-medium rounded-lg py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Redirecting to Google…" : label}
      </button>
      {error && (
        <p role="alert" className="text-red text-xs mt-2">
          {error}
        </p>
      )}
    </>
  );
}
