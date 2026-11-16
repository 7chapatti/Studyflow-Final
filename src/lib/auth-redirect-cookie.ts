// Name of the short-lived cookie that carries "where to go after signing
// in" across the Google sign-in round trip. The sign-in button sets it in
// the browser, and /auth/callback reads and clears it. Kept out of the
// OAuth redirect URL itself so that URL always exactly matches the one
// allow-listed in Supabase.
export const POST_AUTH_COOKIE = "dc_post_auth_next";
export const POST_AUTH_COOKIE_MAX_AGE_SECONDS = 600;
