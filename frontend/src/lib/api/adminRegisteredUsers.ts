// Typed client for GET /admin/registered-users -- docs/API_CONTRACTS.md
// "GET /admin/registered-users". Own module, mirroring the backend split
// (app/schemas/admin_registered_users.py is its own file): a live
// Cognito-backed report, not the local-DB `GET /admin/overview` aggregate.
import { apiFetch, toQueryString } from "./client";
import type { RegisteredUsersResponse } from "@/types/adminRegisteredUsers";
import type { PaginationParams } from "@/types/common";
import type { ActivityEventType, UserActivityResponse } from "@/types/userActivity";

/**
 * GET /admin/registered-users -- auth: admin. Live call, no caching (same
 * posture as `getRegisteredUserCount`/`getAdminOverview`). Can throw
 * `ApiError` with `status === 502` if the upstream Cognito
 * `ListUsersInGroup` call fails.
 */
export async function getRegisteredUsers(
  params: PaginationParams = {},
  accessToken: string
): Promise<RegisteredUsersResponse> {
  const query = toQueryString({
    page: params.page,
    page_size: params.page_size,
  });

  return apiFetch<RegisteredUsersResponse>(
    `/admin/registered-users${query}`,
    { method: "GET", cache: "no-store" },
    { accessToken }
  );
}

/**
 * GET /admin/registered-users/{user_sub}/activity -- auth: admin. One
 * diner's recorded searches and restaurant-tile clicks, newest first,
 * within the retention window (docs/API_CONTRACTS.md). Local DB only, no
 * Cognito call.
 */
export async function getRegisteredUserActivity(
  userSub: string,
  params: PaginationParams & { event_type?: ActivityEventType } = {},
  accessToken: string
): Promise<UserActivityResponse> {
  const query = toQueryString({
    page: params.page,
    page_size: params.page_size,
    event_type: params.event_type,
  });

  return apiFetch<UserActivityResponse>(
    `/admin/registered-users/${encodeURIComponent(userSub)}/activity${query}`,
    { method: "GET", cache: "no-store" },
    { accessToken }
  );
}
