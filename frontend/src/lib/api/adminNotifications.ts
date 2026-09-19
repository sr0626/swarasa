// Typed client for GET /admin/notifications — docs/API_CONTRACTS.md
// "Admin notifications".
import { apiFetch } from "./client";
import type { AdminNotifications } from "@/types/adminNotifications";

/**
 * GET /admin/notifications — auth: admin. Called from the TopBar server
 * component on each page render (so it refreshes on navigation); never
 * cached, since a stale badge defeats the point.
 */
export async function getAdminNotifications(
  accessToken: string
): Promise<AdminNotifications> {
  return apiFetch<AdminNotifications>(
    "/admin/notifications",
    { method: "GET", cache: "no-store" },
    { accessToken }
  );
}
