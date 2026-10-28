// Pure helpers for the admin audit-log viewer (/admin/audit-log): URL state
// and safe snapshot text. Kept out of the page so they can be unit tested
// (`npm run test:unit`, node --test; relative imports only).
import type { AuditJson } from "../types/adminAuditLog.ts";

export const ACTION_OPTIONS: readonly string[] = ["create", "update", "delete"];

/** "restaurant_brand" -> "Restaurant brand". Display only. */
export function entityLabel(tableName: string): string {
  const spaced = tableName.replace(/_/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : tableName;
}

/** A real calendar date in YYYY-MM-DD form, else undefined. */
export function parseDateParam(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10) === value ? value : undefined;
}

/** Entity / action filter values: only the API's accepted charset. */
export function parseToken(value: string | undefined, pattern: RegExp): string | undefined {
  return value && pattern.test(value) ? value : undefined;
}

export const ENTITY_PATTERN = /^[a-z0-9_]{1,64}$/;
export const ACTION_PATTERN = /^[a-z_]{1,16}$/;

export interface AuditViewState {
  page?: number;
  entity?: string;
  action?: string;
  actor?: string;
  date_from?: string;
  date_to?: string;
}

/** `/admin/audit-log` + the current filters; blank values omitted. */
export function buildAuditHref(state: AuditViewState): string {
  const search = new URLSearchParams();
  if (state.entity) search.set("entity", state.entity);
  if (state.action) search.set("action", state.action);
  if (state.actor) search.set("actor", state.actor);
  if (state.date_from) search.set("date_from", state.date_from);
  if (state.date_to) search.set("date_to", state.date_to);
  if (state.page && state.page > 1) search.set("page", String(state.page));
  const query = search.toString();
  return query ? `/admin/audit-log?${query}` : "/admin/audit-log";
}

/** True when the API replaced an oversized snapshot with a text preview. */
export function isTruncatedSnapshot(snapshot: { [key: string]: AuditJson } | null): boolean {
  return snapshot !== null && snapshot["_truncated"] === true;
}

/**
 * Snapshot -> plain text for a <pre>. The result is only ever rendered as a
 * React text node (escaped), never as HTML. Empty/missing -> "(none)".
 */
export function snapshotText(snapshot: { [key: string]: AuditJson } | null): string {
  if (snapshot === null || Object.keys(snapshot).length === 0) return "(none)";
  if (isTruncatedSnapshot(snapshot)) {
    const preview = snapshot["_preview"];
    return `${typeof preview === "string" ? preview : ""}\n... (truncated)`;
  }
  try {
    return JSON.stringify(snapshot, null, 2);
  } catch {
    return "(unreadable snapshot)";
  }
}

/** Keys whose value differs between the two snapshots (sorted). */
export function changedKeys(
  oldVal: { [key: string]: AuditJson } | null,
  newVal: { [key: string]: AuditJson } | null
): string[] {
  const keys = new Set([...Object.keys(oldVal ?? {}), ...Object.keys(newVal ?? {})]);
  return [...keys]
    .filter((key) => JSON.stringify((oldVal ?? {})[key]) !== JSON.stringify((newVal ?? {})[key]))
    .sort();
}
