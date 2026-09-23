// Typed client for GET /admin/registered-user-count — docs/API_CONTRACTS.md
// "GET /admin/registered-user-count". Own module (not folded into
// adminOverview.ts), mirroring the backend's own split
// (app/schemas/admin_stats.py vs app/schemas/admin_overview.py): this is a
// live Cognito call, not a local-DB aggregate, and can fail independently
// (502 on an upstream Cognito error) without the rest of the overview
// page's data.
import { apiFetch } from "./client";
import type { RegisteredUserCount } from "@/types/adminStats";

/**
 * GET /admin/registered-user-count — auth: admin. Live call, no caching
 * (same posture as `getAdminOverview`/`getAdminNotifications`) — counts
 * the Cognito `registered_user` pool group directly, so a stale count
 * defeats the point. Can throw `ApiError` with `status === 502` if the
 * upstream Cognito `ListUsersInGroup` call fails; callers should handle
 * that as "unavailable," not a fatal page error (see
 * `admin/overview/page.tsx`).
 */
export async function getRegisteredUserCount(accessToken: string): Promise<RegisteredUserCount> {
  return apiFetch<RegisteredUserCount>(
    "/admin/registered-user-count",
    { method: "GET", cache: "no-store" },
    { accessToken }
  );
}
