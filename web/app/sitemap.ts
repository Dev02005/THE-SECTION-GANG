import type { MetadataRoute } from "next";

const SITE = "https://corridor-rail.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: SITE, lastModified: now, priority: 1 },
    { url: `${SITE}/planner`, lastModified: now, priority: 0.9 },
    { url: `${SITE}/plan`, lastModified: now, priority: 0.8 },
    { url: `${SITE}/method`, lastModified: now, priority: 0.7 },
    { url: `${SITE}/network`, lastModified: now, priority: 0.6 },
    { url: `${SITE}/scale`, lastModified: now, priority: 0.6 },
    { url: `${SITE}/limits`, lastModified: now, priority: 0.6 },
    { url: `${SITE}/login`, lastModified: now, priority: 0.3 },
  ];
}
