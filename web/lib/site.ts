/**
 * The site's public address - for canonical links, the share image, robots and
 * the sitemap.
 *
 * It was typed three times, in layout.tsx, robots.ts and sitemap.ts, and all
 * three still said `corridor-rail.vercel.app` after the real deployment went
 * live at another address. The damage was concrete: the Open Graph image
 * pointed at a domain that did not exist, so a shared link showed a broken
 * preview card. One constant now, imported by all three.
 *
 * On Vercel it reads VERCEL_PROJECT_PRODUCTION_URL, the system variable holding
 * the project's production domain, so adding a custom domain later updates it
 * without anyone remembering to. Elsewhere - a local build, another host - it
 * falls back to the address the project is actually deployed at.
 */
const PRODUCTION = process.env.VERCEL_PROJECT_PRODUCTION_URL;

export const SITE = PRODUCTION
  ? `https://${PRODUCTION}`
  : "https://the-section-gang.vercel.app";
