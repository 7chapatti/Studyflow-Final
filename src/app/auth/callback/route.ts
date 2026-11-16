import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/redirect";
import { POST_AUTH_COOKIE } from "@/lib/auth-redirect-cookie";

// Lands here from two places: the email-confirmation link, and Google
// sign-in (Supabase sends the browser back with a one-time ?code=).
//
// Where to go next comes from ?next= or, for Google sign-in, from a
// short-lived cookie the sign-in button set before leaving the site. Either
// way the value is user-controllable, so it only ever passes through
// safeRedirectPath() and is appended to this site's own origin.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  const cookieStore = await cookies();
  const cookieNext = cookieStore.get(POST_AUTH_COOKIE)?.value;
  const next = safeRedirectPath(
    searchParams.get("next") ?? (cookieNext ? decodeURIComponentSafe(cookieNext) : null)
  );

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const response = NextResponse.redirect(`${origin}${next}`);
      response.cookies.delete(POST_AUTH_COOKIE);
      return response;
    }
  }

  const response = NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  response.cookies.delete(POST_AUTH_COOKIE);
  return response;
}

function decodeURIComponentSafe(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
