// Restaurant-tile click tracking for signed-in registered users
// (docs/API_CONTRACTS.md "Activity tracking (`/activity`)"). Pure helpers,
// no React, no `next/*` imports — shared by the client-side link component
// (sends) and the same-origin route handler (validates), and unit-testable
// with Node's built-in runner.
//
// Flow: <TrackedTileLink> onClick -> `sendTileClick` -> `navigator.sendBeacon`
// to /api/activity/tile-click (a same-origin Next route handler that reads the
// httpOnly session cookie and calls the typed backend client). sendBeacon is
// deliberate: it is fire-and-forget and survives the navigation the click
// triggers, so tracking can never delay or block opening the restaurant page.
import type { ActivitySource, TileClickInput } from "@/types/userActivity";

/** Same-origin endpoint the beacon posts to. */
export const TILE_CLICK_ENDPOINT = "/api/activity/tile-click";

const SOURCES: readonly ActivitySource[] = ["search_results", "homepage", "favourites"];

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Validates an untrusted request body into a `TileClickInput`, or `null`.
 * Only the three known fields are ever copied over — nothing else the client
 * sends is forwarded to the backend.
 */
export function parseTileClickBody(body: unknown): TileClickInput | null {
  if (!body || typeof body !== "object") return null;
  const candidate = body as Record<string, unknown>;

  if (!isPositiveInt(candidate.brand_id)) return null;
  const locationId = candidate.location_id ?? null;
  if (locationId !== null && !isPositiveInt(locationId)) return null;
  if (!SOURCES.includes(candidate.source as ActivitySource)) return null;

  return {
    brand_id: candidate.brand_id,
    location_id: locationId,
    source: candidate.source as ActivitySource,
  };
}

/** The slice of `navigator`/`fetch` `sendTileClick` needs — injectable for tests. */
export interface TileClickTransport {
  sendBeacon?: (url: string, data: Blob) => boolean;
  fetchKeepalive?: (url: string, init: RequestInit) => Promise<unknown>;
}

/**
 * Fire-and-forget. Never throws and never returns a promise the caller must
 * await: any failure is swallowed, because tracking must not affect the click.
 * Prefers `sendBeacon`; falls back to a keepalive fetch when the beacon is
 * unavailable or refuses the payload.
 */
export function sendTileClick(input: TileClickInput, transport: TileClickTransport): void {
  try {
    const json = JSON.stringify(input);
    if (transport.sendBeacon) {
      const queued = transport.sendBeacon(
        TILE_CLICK_ENDPOINT,
        new Blob([json], { type: "application/json" })
      );
      if (queued) return;
    }
    if (transport.fetchKeepalive) {
      void transport
        .fetchKeepalive(TILE_CLICK_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: json,
          keepalive: true,
        })
        .catch(() => undefined);
    }
  } catch {
    // Tracking is best-effort by design.
  }
}

/** Browser wiring for `sendTileClick`. Client-side only. */
export function trackTileClick(input: TileClickInput): void {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  sendTileClick(input, {
    sendBeacon: nav?.sendBeacon ? nav.sendBeacon.bind(nav) : undefined,
    fetchKeepalive: typeof fetch === "function" ? (url, init) => fetch(url, init) : undefined,
  });
}
