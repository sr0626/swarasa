// Typed client for GET /admin/managers -- docs/API_CONTRACTS.md
// "GET /admin/managers". Local-DB report; the Cognito email lookup is
// best-effort server-side (`email_lookup_degraded`), so this call has no
// 502 failure mode.
import { apiFetch, toQueryString } from "./client";
import type { AdminManagersParams, AdminManagersResponse } from "@/types/adminManagers";

/** GET /admin/managers -- auth: admin. Live call, no caching. */
export async function getAdminManagers(
  params: AdminManagersParams = {},
  accessToken: string
): Promise<AdminManagersResponse> {
  const query = toQueryString({
    page: params.page,
    page_size: params.page_size,
    q: params.q,
    sort: params.sort,
  });

  return apiFetch<AdminManagersResponse>(
    `/admin/managers${query}`,
    { method: "GET", cache: "no-store" },
    { accessToken }
  );
}
