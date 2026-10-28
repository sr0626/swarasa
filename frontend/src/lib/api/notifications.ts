// Typed client for the in-app deal alerts — docs/API_CONTRACTS.md
// "Notifications". registered_user only. The list is read server-side by the
// TopBar server component; the two writes are called from Server Actions
// (lib/actions/notifications.ts) because the Cognito token lives in an
// httpOnly cookie the browser cannot read.
import { apiFetch, toQueryString } from "./client";
import type { NotificationList, NotificationsReadAll } from "@/types/notification";

/** Alerts shown in the bell dropdown (newest first). */
export const BELL_PAGE_SIZE = 10;

/**
 * GET /notifications — auth: registered_user. Never cached: a stale badge
 * defeats the point.
 */
export async function getNotifications(
  accessToken: string,
  pageSize: number = BELL_PAGE_SIZE
): Promise<NotificationList> {
  return apiFetch<NotificationList>(
    `/notifications${toQueryString({ page: 1, page_size: pageSize })}`,
    { method: "GET", cache: "no-store" },
    { accessToken }
  );
}

/** POST /notifications/{id}/read — 204, idempotent; 404 if not the caller's. */
export async function markNotificationRead(id: number, accessToken: string): Promise<void> {
  return apiFetch<void>(`/notifications/${id}/read`, { method: "POST" }, { accessToken });
}

/** POST /notifications/read-all. */
export async function markAllNotificationsRead(
  accessToken: string
): Promise<NotificationsReadAll> {
  return apiFetch<NotificationsReadAll>(
    "/notifications/read-all",
    { method: "POST" },
    { accessToken }
  );
}
