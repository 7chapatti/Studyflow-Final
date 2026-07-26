import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeRedirect(origin: string, next: string) {
  try {
    const url = new URL(next, origin);
    if (url.origin === origin) return url.toString();
  } catch {
    // fall through to default
  }

  return `${origin}/dashboard`;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(safeRedirect(origin, next));
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
