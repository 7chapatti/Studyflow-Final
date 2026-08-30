// IP-based rate limiting for endpoints that call paid/abusable third-party
// APIs (OpenAI, Stripe). Backed by the check_rate_limit() Postgres function
// (see the accompanying migration) so limits are enforced correctly across
// serverless instances, not just within one process's memory.
//
// This exists alongside, not instead of, the per-user monthly AI quota in
// consumeAIQuota(): the quota stops one account from using more analyses
// than its tier allows; this stops one IP from hammering the endpoint
// across many accounts (e.g. signing up for several free accounts to get
// more AI analyses than one account's quota permits) or just scripting
// requests fast enough to run up your OpenAI/Stripe bill before any
// per-account limit would even kick in.
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export function getClientIp(request: Request): string {
  // Vercel (and most reverse proxies) set x-forwarded-for as a
  // client-first, comma-separated list. Fall back to a fixed key rather
  // than throwing if neither header is present (e.g. local dev without a
  // proxy in front) -- that just means everyone shares one bucket locally,
  // which is fine since it's not a production path.
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  return "unknown";
}

/**
 * Returns true if the request should be allowed, false if the caller has
 * exceeded `maxRequests` within the trailing `windowSeconds`.
 *
 * Fails open (returns true) if the rate-limit check itself errors, so a
 * database hiccup degrades to "no rate limiting" rather than blocking every
 * request in the app -- availability for real users matters more than
 * enforcing this particular guard rail during a transient outage.
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key: key,
      p_max_requests: maxRequests,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      logger.error("Rate limit check failed", { detail: error });
      return true;
    }

    return data === true;
  } catch (err) {
    logger.error("Rate limit check threw", { detail: err });
    return true;
  }
}
