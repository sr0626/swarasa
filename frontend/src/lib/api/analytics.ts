// Typed client for owner analytics — docs/API_CONTRACTS.md "Owner analytics".
import { apiFetch } from "./client";
import type { AnalyticsRange, LocationAnalytics, TrackEvent } from "@/types/analytics";

/** POST /track/location/{id} — public counter increment, 204. The token is
 * optional and used by the backend ONLY to drop an owner's/manager's/admin's
 * own views of their location. Called from the same-origin relay route
 * (app/api/track/route.ts), never from a component. */
export async function recordLocationEvent(
  locationId: number,
  event: TrackEvent,
  accessToken?: string | null
): Promise<void> {
  await apiFetch<void>(
    `/track/location/${locationId}`,
    { method: "POST", body: JSON.stringify({ event }) },
    { accessToken }
  );
}

/** GET /locations/{id}/analytics — owner / assigned manager / admin. */
export async function getLocationAnalytics(
  locationId: number,
  days: AnalyticsRange,
  accessToken: string
): Promise<LocationAnalytics> {
  return apiFetch<LocationAnalytics>(
    `/locations/${locationId}/analytics?days=${days}`,
    { method: "GET" },
    { accessToken }
  );
}
