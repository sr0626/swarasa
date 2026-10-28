// Typed client for the admin user directory -- docs/API_CONTRACTS.md
// "GET /admin/users" and "POST /admin/users/{username}/...". Live
// Cognito-backed: the list can throw ApiError 502 when Cognito fails.
import { apiFetch, toQueryString } from "./client";
import type {
  AdminUserAction,
  AdminUserActionResult,
  AdminUsersParams,
  AdminUsersResponse,
} from "@/types/adminUsers";

/** GET /admin/users -- auth: admin. Live call, no caching. */
export async function getAdminUsers(
  params: AdminUsersParams = {},
  accessToken: string
): Promise<AdminUsersResponse> {
  const query = toQueryString({
    page: params.page,
    page_size: params.page_size,
    q: params.q,
    role: params.role,
    status: params.status,
    sort: params.sort,
  });
  return apiFetch<AdminUsersResponse>(
    `/admin/users${query}`,
    { method: "GET", cache: "no-store" },
    { accessToken }
  );
}

/**
 * POST /admin/users/{username}/{action} -- auth: admin. Disable/reset are
 * refused server-side for yourself and the last admin (403/409).
 */
export async function runAdminUserAction(
  username: string,
  action: AdminUserAction,
  accessToken: string
): Promise<AdminUserActionResult> {
  return apiFetch<AdminUserActionResult>(
    `/admin/users/${encodeURIComponent(username)}/${action}`,
    { method: "POST" },
    { accessToken }
  );
}
