// Typed client for GET /admin/audit-log -- docs/API_CONTRACTS.md
// "GET /admin/audit-log". Read-only, local DB (email lookup is best-effort
// server-side), so no 502 failure mode.
import { apiFetch, toQueryString } from "./client";
import type { AuditLogParams, AuditLogResponse } from "@/types/adminAuditLog";

/** GET /admin/audit-log -- auth: admin. Live call, no caching. */
export async function getAdminAuditLog(
  params: AuditLogParams = {},
  accessToken: string
): Promise<AuditLogResponse> {
  const query = toQueryString({
    page: params.page,
    page_size: params.page_size,
    entity: params.entity,
    action: params.action,
    actor: params.actor,
    date_from: params.date_from,
    date_to: params.date_to,
  });
  return apiFetch<AuditLogResponse>(
    `/admin/audit-log${query}`,
    { method: "GET", cache: "no-store" },
    { accessToken }
  );
}
