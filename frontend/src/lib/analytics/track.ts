// Best-effort public engagement beacons (page view, tile click, deal view,
// website / directions / phone clicks) for the owner Insights counters
// (docs/API_CONTRACTS.md "Owner analytics"). Pure helpers — no React, no
// `next/*` — shared by the client tracker (sends) and the same-origin relay
// route (validates), unit-testable with Node's built-in runner.
//
// Privacy: the beacon body is just `{ location_id, event }`. No cookie is set
// and nothing identifies the visitor; the only client state is a
// `sessionStorage` flag so a page refresh doesn't count as a second view.
//
// Never blocks or surfaces anything: every failure is swallowed.
import type { TrackEvent, TrackEventInput } from "@/types/analytics";

/** Same-origin relay the beacons post to. */
export const TRACK_ENDPOINT = "/api/track";

export const TRACK_EVENTS: readonly TrackEvent[] = [
  "page_view",
  "tile_click",
  "deal_view",
  "website_click",
  "directions_click",
  "phone_click",
];

/** `data-track` attribute values on public links, mapped to events. */
export const LINK_EVENTS: Readonly<Record<string, TrackEvent>> = {
  website: "website_click",
  directions: "directions_click",
  phone: "phone_click",
};

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Validates an untrusted relay body; only the two known fields are copied. */
export function parseTrackBody(body: unknown): TrackEventInput | null {
  if (!body || typeof body !== "object") return null;
  const candidate = body as Record<string, unknown>;
  if (!isPositiveInt(candidate.location_id)) return null;
  if (!TRACK_EVENTS.includes(candidate.event as TrackEvent)) return null;
  return { location_id: candidate.location_id, event: candidate.event as TrackEvent };
}

/** The slice of `navigator`/`fetch` `sendTrackEvent` needs — injectable for tests. */
export interface TrackTransport {
  sendBeacon?: (url: string, data: Blob) => boolean;
  fetchKeepalive?: (url: string, init: RequestInit) => Promise<unknown>;
}

/** Fire-and-forget; never throws. Prefers `sendBeacon`, falls back to a keepalive fetch. */
export function sendTrackEvent(input: TrackEventInput, transport: TrackTransport): void {
  try {
    const json = JSON.stringify(input);
    if (transport.sendBeacon) {
      const queued = transport.sendBeacon(TRACK_ENDPOINT, new Blob([json], { type: "application/json" }));
      if (queued) return;
    }
    if (transport.fetchKeepalive) {
      void transport
        .fetchKeepalive(TRACK_ENDPOINT, {
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

/** Browser wiring for `sendTrackEvent`. Client-side only. */
export function trackLocationEvent(locationId: number, event: TrackEvent): void {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  sendTrackEvent(
    { location_id: locationId, event },
    {
      sendBeacon: nav?.sendBeacon ? nav.sendBeacon.bind(nav) : undefined,
      fetchKeepalive: typeof fetch === "function" ? (url, init) => fetch(url, init) : undefined,
    }
  );
}

/** The minimal `Storage` surface `shouldCountOnce` uses. */
export interface OnceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * True the first time `key` is seen in this browsing session, false after
 * (so a refresh or back/forward doesn't inflate views). If storage is
 * unavailable (private mode, blocked) it returns true — an occasional
 * double count beats dropping the view.
 */
export function shouldCountOnce(storage: OnceStorage | null, key: string): boolean {
  if (!storage) return true;
  try {
    if (storage.getItem(key) !== null) return false;
    storage.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}

/** Session-dedup key for one event on one location. */
export function onceKey(locationId: number, event: TrackEvent): string {
  return `swarasa:track:${event}:${locationId}`;
}
