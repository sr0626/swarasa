// Typed client for GET /admin/overview — docs/API_CONTRACTS.md "GET
// /admin/overview".
import { apiFetch, toQueryString } from "./client";
import type { AdminOverview } from "@/types/adminOverview";
import type { PaginationParams } from "@/types/common";

/**
 * GET /admin/overview — auth: admin. `page`/`page_size` paginate the
 * owner breakdown only; the restaurant/tier counts are always
 * platform-wide totals. Never cached (`cache: "no-store"`, same posture
 * as `getAdminNotifications`) — a stale platform overview is worse than a
 * slightly slower one.
 */
export async function getAdminOverview(
  params: PaginationParams = {},
  accessToken: string
): Promise<AdminOverview> {
  const query = toQueryString({
    page: params.page,
    page_size: params.page_size,
  });

  return apiFetch<AdminOverview>(
    `/admin/overview${query}`,
    { method: "GET", cache: "no-store" },
    { accessToken }
  );
}
