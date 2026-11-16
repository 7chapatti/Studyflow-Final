// Google OAuth for the Calendar connection.
//
// This is separate from "Sign in with Google" (which Supabase handles and
// which only asks for name and email). Calendar access is asked for on its
// own, only when someone presses "Connect Google Calendar" in settings, so
// signing in never requests more than it needs and people who signed up
// with a password can connect a calendar too.
//
// The scope is the narrowest one that does the job. calendar.app.created
// lets Duecourse create its own secondary calendar and manage events on
// that calendar only. It cannot read, change or delete anything on the
// user's other calendars.
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";

// Holds the random `state` value between leaving for Google and coming
// back. httpOnly and scoped to the calendar routes only.
export const CALENDAR_STATE_COOKIE = "dc_gcal_state";
export const CALENDAR_STATE_COOKIE_PATH = "/api/google/calendar";
export const CALENDAR_STATE_MAX_AGE_SECONDS = 600;

export function isGoogleCalendarConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
  );
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function calendarRedirectUri(): string {
  return `${appUrl()}/api/google/calendar/callback`;
}

export function buildCalendarAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: calendarRedirectUri(),
    response_type: "code",
    scope: CALENDAR_SCOPE,
    // offline + consent is what makes Google return a refresh token, which
    // is needed to sync later without the user being present.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

async function postToken(body: Record<string, string>) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...body,
    }),
  });

  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    error?: string;
  };

  if (!response.ok || !json.access_token) {
    throw new GoogleAuthError("Google token request failed", json.error ?? `http_${response.status}`);
  }
  return json;
}

export async function exchangeCodeForTokens(code: string) {
  const json = await postToken({
    code,
    grant_type: "authorization_code",
    redirect_uri: calendarRedirectUri(),
  });

  if (!json.refresh_token) {
    throw new GoogleAuthError("Google did not return a refresh token", "no_refresh_token");
  }
  // The consent screen lets people untick individual permissions. Without
  // the calendar one there is nothing this connection can do.
  if (!(json.scope ?? "").split(" ").includes(CALENDAR_SCOPE)) {
    throw new GoogleAuthError("Calendar permission was not granted", "scope_not_granted");
  }

  return { accessToken: json.access_token!, refreshToken: json.refresh_token };
}

// Returns a short-lived access token. Throws GoogleAuthError with code
// "invalid_grant" when the user has revoked access (or the token has
// otherwise died), which callers treat as "disconnected".
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const json = await postToken({ refresh_token: refreshToken, grant_type: "refresh_token" });
  return json.access_token!;
}

// Best-effort: tells Google to invalidate the token. A failure here must
// not stop a disconnect or account deletion, since the stored copy is
// deleted either way.
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // ignored on purpose, see above
  }
}
