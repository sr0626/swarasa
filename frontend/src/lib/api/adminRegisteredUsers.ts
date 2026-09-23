// Typed client for GET /admin/registered-users -- docs/API_CONTRACTS.md
// "GET /admin/registered-users". Own module, mirroring the backend split
// (app/schemas/admin_registered_users.py is its own file): a live
// Cognito-backed report, not the local-DB `GET /admin/overview` aggregate.
import { apiFetch, toQueryString } from "./client";
import type { RegisteredUsersResponse } from "@/types/adminRegisteredUsers";
import type { PaginationParams } from "@/types/common";

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
