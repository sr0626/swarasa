// Orchestration helpers for the admin bulk import, pure with injected I/O
// (adminImportRun.test.ts): the sequential chunk runner (progress, stop,
// resume) and the bounded-time geocoder pass used by the import server action.
import type { CommittedRow, ImportRowInput } from "../types/adminImport";

export type SendResult = { ok: true; rows: CommittedRow[] } | { ok: false; error: string };

export interface RunState {
  /** Results for every row of every chunk that completed. */
  results: CommittedRow[];
  /** Chunks not yet completed (the one that failed first, if any). Pass back to resume. */
  remaining: ImportRowInput[][];
  stopped: "done" | "user" | "error";
  error?: string;
}

/**
 * Send chunks one at a time. Sequential on purpose: one request in flight
 * keeps each Lambda call small, and a later chunk's duplicate check then sees
 * the rows an earlier chunk just wrote. Stops at the first failed request or
 * when `shouldStop()` turns true (checked between chunks); the failed chunk is
 * left in `remaining`, so resuming re-sends it — safe, because commit is
 * idempotent (already-created rows come back as skipped duplicates).
 */
export async function runChunks(
  chunks: ImportRowInput[][],
  send: (chunk: ImportRowInput[]) => Promise<SendResult>,
  hooks: {
    onProgress?: (doneChunks: number, totalChunks: number, results: CommittedRow[]) => void;
    shouldStop?: () => boolean;
  } = {},
  previous: CommittedRow[] = []
): Promise<RunState> {
  const results = [...previous];
  const total = chunks.length;
  for (let i = 0; i < total; i++) {
    if (hooks.shouldStop?.()) {
      return { results, remaining: chunks.slice(i), stopped: "user" };
    }
    const chunk = chunks[i];
    if (!chunk) continue;
    let outcome: SendResult;
    try {
      outcome = await send(chunk);
    } catch {
      outcome = { ok: false, error: "The connection dropped." };
    }
    if (!outcome.ok) {
      return { results, remaining: chunks.slice(i), stopped: "error", error: outcome.error };
    }
    results.push(...outcome.rows);
    hooks.onProgress?.(i + 1, total, results);
  }
  return { results, remaining: [], stopped: "done" };
}

export interface GeocodeHit {
  latitude: number;
  longitude: number;
}

export interface GeocodeOptions {
  concurrency: number;
  /** Stop starting new lookups once this many ms have passed. */
  deadlineMs: number;
  now: () => number;
}

function hasCoordinates(row: ImportRowInput): boolean {
  const blank = (v: string | number | null | undefined) => v === null || v === undefined || String(v).trim() === "";
  return !blank(row.latitude) && !blank(row.longitude);
}

/**
 * Fill latitude/longitude for rows that have none, using an injected
 * geocoder (the project's Census-then-Nominatim chain, server side). Bounded
 * by `concurrency` and a wall-clock deadline: rows not reached, or that the
 * geocoder cannot place, are returned UNCHANGED (the API then flags them
 * `needs_geocoding`) — a miss never blocks the import. Order is preserved.
 */
export async function geocodeRows(
  rows: ImportRowInput[],
  geocode: (row: ImportRowInput) => Promise<GeocodeHit | null>,
  options: GeocodeOptions
): Promise<{ rows: ImportRowInput[]; geocoded: number }> {
  const out = rows.map((r) => ({ ...r }));
  const queue = out.map((r, i) => ({ r, i })).filter(({ r }) => !hasCoordinates(r) && r.address_line1 && r.city && r.state);
  const started = options.now();
  let geocoded = 0;
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      if (options.now() - started >= options.deadlineMs) return;
      const item = queue[next++];
      if (!item) return;
      let hit: GeocodeHit | null = null;
      try {
        hit = await geocode(item.r);
      } catch {
        hit = null;
      }
      if (hit) {
        item.r.latitude = hit.latitude;
        item.r.longitude = hit.longitude;
        geocoded++;
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, options.concurrency) }, () => worker());
  await Promise.all(workers);
  return { rows: out, geocoded };
}
