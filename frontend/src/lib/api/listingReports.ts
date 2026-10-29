// Typed client for /reports — docs/API_CONTRACTS.md "Listing reports
// (`/reports`)".
import { apiFetch, toQueryString } from "./client";
import type { PaginatedResponse, PaginationParams } from "@/types/common";
import type {
  CreateReportInput,
  ListingReport,
  ReportCategory,
  ReportReceipt,
  ReportStatus,
  UpdateReportInput,
} from "@/types/listingReport";

/**
 * POST /reports — PUBLIC. `accessToken` is optional: when a signed-in
 * caller's token is present the backend attributes the report to their
 * Cognito sub; anonymous callers omit it.
 */
export async function submitReport(
  input: CreateReportInput,
  accessToken?: string | null
): Promise<ReportReceipt> {
  return apiFetch<ReportReceipt>(
    "/reports",
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/**
 * GET /reports — auth: admin. `status` omitted = every status, newest
 * first; `status: "new"` is the oldest-first triage queue.
 */
export async function listReports(
  params: PaginationParams & { status?: ReportStatus; category?: ReportCategory },
  accessToken: string
): Promise<PaginatedResponse<ListingReport>> {
  const query = toQueryString({
    status: params.status,
    category: params.category,
    page: params.page,
    page_size: params.page_size,
  });
  return apiFetch<PaginatedResponse<ListingReport>>(
    `/reports${query}`,
    { method: "GET" },
    { accessToken }
  );
}

/** PATCH /reports/{id} — auth: admin. */
export async function updateReport(
  id: number,
  input: UpdateReportInput,
  accessToken: string
): Promise<ListingReport> {
  return apiFetch<ListingReport>(
    `/reports/${id}`,
    { method: "PATCH", body: JSON.stringify(input) },
    { accessToken }
  );
}
