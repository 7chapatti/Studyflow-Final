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
        {
          key: "Content-Security-Policy",
          value:
            process.env.NODE_ENV === "production"
              ? [
                  "default-src 'self'",
                  "script-src 'self' 'unsafe-inline'",
                  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
                  "font-src 'self' https://fonts.gstatic.com",
                  "img-src 'self' data: blob:",
                  "connect-src 'self' https://*.supabase.co https://api.openai.com",
                ].join("; ")
              : "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
        },
      ],
    },
  ],
};

export default nextConfig;
