import type { MetadataRoute } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: APP_URL,
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: `${APP_URL}/upgrade`,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${APP_URL}/privacy`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${APP_URL}/terms`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
