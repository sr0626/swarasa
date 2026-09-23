// Display helpers for the admin per-user activity view. Pure (no React / no
// `next/*`), so they can be unit-tested with Node's built-in runner.
import type { ActivitySource, SearchEventPayload } from "@/types/userActivity";

export const SOURCE_LABELS: Record<ActivitySource, string> = {
  search_results: "Search results",
  homepage: "Homepage",
  favourites: "Favourites",
};

export function sourceLabel(source: string): string {
  return (SOURCE_LABELS as Record<string, string>)[source] ?? source;
}

/** "north_indian" -> "north indian" (tag slugs are shown as recorded, just readable). */
function readable(slug: string): string {
  return slug.replace(/_/g, " ");
}

/**
 * One short line per recorded criterion of a search, in a stable order.
 * Never empty for a real event (the backend only records searches that had
 * at least one criterion), but returns `["No details recorded"]` defensively.
 */
export function describeSearch(payload: SearchEventPayload): string[] {
  const lines: string[] = [];
  if (payload.q) lines.push(`Text: “${payload.q}”`);
  if (payload.cuisine?.length) lines.push(`Cuisine: ${payload.cuisine.map(readable).join(", ")}`);
  if (payload.dietary?.length) lines.push(`Dietary: ${payload.dietary.map(readable).join(", ")}`);
  if (payload.type?.length) lines.push(`Type: ${payload.type.map(readable).join(", ")}`);
  if (payload.loc) lines.push(`Location: ${payload.loc}`);
  if (payload.has_deals_today) lines.push("Deals today only");
  return lines.length ? lines : ["No details recorded"];
}

export function describeResultCount(count: number | undefined): string | null {
  if (count === undefined) return null;
  return `${count} result${count === 1 ? "" : "s"}`;
}
