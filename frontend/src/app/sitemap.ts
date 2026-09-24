// Native Next.js 14 App Router sitemap — served automatically at
// /sitemap.xml, no separate route handler needed (frontend/CLAUDE.md "SEO
// Requirements": "sitemap.xml generated at build time from all active
// locations").
//
// Every ACTIVE location page is listed, from the public, paginated
// `GET /sitemap/locations` index (one row per active location of every live
// brand, with the brand's active-location count) — not from /search, which is
// brand-level and would miss every location but one per brand. Only CANONICAL
// URLs are emitted (lib/restaurant/urls.ts):
//   - single-location brand  -> /restaurant/{brand}                 (the long
//                               location URL works but canonicalises here)
//   - multi-location brand   -> /restaurant/{brand} (the landing page) AND
//                               /restaurant/{brand}/{location} for each location
import type { MetadataRoute } from "next";
import { getPublicLocationIndex } from "@/lib/api/sitemap";
import { canonicalPathsForRow } from "@/lib/restaurant/sitemapPaths";
import { SITE_URL } from "@/lib/site";
import type { PublicLocationIndexItem } from "@/types/restaurant";

const INDEX_PAGE_SIZE = 100;
/** Hard stop so a backend bug (e.g. `total` never shrinking) can't turn this
 * into an unbounded loop against a public endpoint. Comfortably above any
 * realistic Phase 1 DFW location count (docs/DECISIONS.md "Data seeding":
 * ~500 seeded restaurants). */
const MAX_PAGES = 100;

async function fetchAllPublicLocations(): Promise<PublicLocationIndexItem[]> {
  const all: PublicLocationIndexItem[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await getPublicLocationIndex({ page, page_size: INDEX_PAGE_SIZE });
    all.push(...result.results);
    if (result.results.length < INDEX_PAGE_SIZE || all.length >= result.total) break;
  }
  return all;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
  ];

  try {
    const rows = await fetchAllPublicLocations();
    const modified = new Map<string, Date>();
    for (const row of rows) {
      for (const path of canonicalPathsForRow(row)) {
        const updated = new Date(row.updated_at);
        const previous = modified.get(path);
        if (!previous || updated > previous) modified.set(path, updated);
      }
    }
    for (const [path, lastModified] of modified) {
      entries.push({
        url: `${SITE_URL}${path}`,
        lastModified,
        changeFrequency: "weekly",
        priority: 0.8,
      });
    }
  } catch {
    // Backend unreachable at build/request time — still serve a valid
    // sitemap with just the homepage rather than failing the whole route
    // (frontend/CLAUDE.md "ALWAYS handle API errors gracefully").
  }

  return entries;
}
