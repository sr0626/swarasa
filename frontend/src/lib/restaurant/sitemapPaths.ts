// Which canonical URL paths one row of `GET /sitemap/locations` contributes to
// sitemap.xml (app/sitemap.ts). Pure: unit-tested with `node --test`.
//
//   single-location brand -> just the short brand URL (the long location URL
//                            canonicalises to it, so it must NOT be listed)
//   multi-location brand  -> the brand landing URL plus this location's page
//
// The two path shapes are written out here (not imported from ./urls) because
// this module must run under `node --test` without a `.ts` import specifier;
// sitemapPaths.test.ts asserts they stay identical to `brandHref`/`locationHref`.
const brandPath = (brandSlug: string): string => `/restaurant/${brandSlug}`;
const locationPath = (brandSlug: string, locationSlug: string): string =>
  `/restaurant/${brandSlug}/${locationSlug}`;

export interface SitemapIndexRow {
  brand_slug: string;
  location_slug: string;
  active_location_count: number;
}

export function canonicalPathsForRow(row: SitemapIndexRow): string[] {
  return row.active_location_count === 1
    ? [brandPath(row.brand_slug)]
    : [brandPath(row.brand_slug), locationPath(row.brand_slug, row.location_slug)];
}

/** De-duplicated canonical paths for all rows, in first-seen order. */
export function canonicalPathsForRows(rows: readonly SitemapIndexRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const path of canonicalPathsForRow(row)) seen.add(path);
  }
  return [...seen];
}
