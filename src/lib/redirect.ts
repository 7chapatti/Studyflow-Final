// One place that decides whether a "send the user here after login" value
// is safe to follow. Used by both the login page (?redirectTo=) and the
// auth callback route (?next=), so the two can't drift apart.
//
// The value comes straight from the URL, so anyone can craft a link like
// /login?redirectTo=... and send it to a user. Only same-site paths may
// pass; everything else falls back to the dashboard. The earlier inline
// check on the login page (starts with "/" and not "//") missed
// "/\evil.com": browsers treat a backslash as a forward slash in URLs, so
// that string resolves to "//evil.com", i.e. another site entirely.
const PLACEHOLDER_ORIGIN = "https://internal.invalid";

export function safeRedirectPath(
  target: string | null | undefined,
  fallback = "/dashboard"
): string {
  if (!target || !target.startsWith("/")) return fallback;
  if (target.startsWith("//") || target.includes("\\")) return fallback;
  // URL parsers silently strip tabs and newlines, so "/\t/evil.com" would
  // otherwise collapse into "//evil.com" after the checks above.
  if (/[\u0000-\u001f\u007f]/.test(target)) return fallback;

  try {
    const url = new URL(target, PLACEHOLDER_ORIGIN);
    if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
