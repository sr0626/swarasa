// Typed client for GET /admin/owners -- docs/API_CONTRACTS.md
// "GET /admin/owners". Local-DB report (no Cognito call, unlike
// `getRegisteredUsers`), so it has no 502 upstream failure mode.
import { apiFetch, toQueryString } from "./client";
import type { AdminOwnersParams, AdminOwnersResponse } from "@/types/adminOwners";

/** GET /admin/owners -- auth: admin. Live call, no caching. */
export async function getAdminOwners(
  params: AdminOwnersParams = {},
  accessToken: string
): Promise<AdminOwnersResponse> {
  const query = toQueryString({
    page: params.page,
    page_size: params.page_size,
    q: params.q,
    sort: params.sort,
  });

  return apiFetch<AdminOwnersResponse>(
    `/admin/owners${query}`,
    { method: "GET", cache: "no-store" },
    { accessToken }
  );
}
