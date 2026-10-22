import type { NextConfig } from "next";
const appOrigin = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
  /^https?:\/\//,
  ""
);

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: [appOrigin],
    },
  },
  // Content-Security-Policy is deliberately NOT set here any more. It used
  // to be a static `script-src 'self' 'unsafe-inline'` -- which is exactly
  // what HTTP Observatory/Lighthouse flag, since 'unsafe-inline' lets any
  // injected inline <script> run, not just the app's own. It's now built
  // per-request in src/middleware.ts with a fresh nonce instead, which is
  // the pattern Next.js itself documents for this
  // (https://nextjs.org/docs/app/guides/content-security-policy) -- a
  // static header here can't carry a per-request nonce, and setting CSP in
  // both places would send two conflicting headers.
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-XSS-Protection", value: "1; mode=block" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ],
    },
  ],
};

export default nextConfig;
