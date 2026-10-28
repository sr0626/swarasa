// Typed client for the admin bulk listing import — docs/API_CONTRACTS.md
// "Admin bulk listing import". Both calls are auth: admin.
import { apiFetch } from "./client";
import type { CommitResponse, ImportRowInput, ValidateResponse } from "@/types/adminImport";

/** POST /admin/import/validate — dry run over the whole file (<= 500 rows). */
export async function validateImportRows(
  rows: ImportRowInput[],
  accessToken: string
): Promise<ValidateResponse> {
  return apiFetch<ValidateResponse>(
    "/admin/import/validate",
    { method: "POST", body: JSON.stringify({ rows }) },
    { accessToken }
  );
}

/** POST /admin/import/commit — writes one chunk (<= 50 rows). Idempotent. */
export async function commitImportRows(
  rows: ImportRowInput[],
  includeWarnings: boolean,
  accessToken: string
): Promise<CommitResponse> {
  return apiFetch<CommitResponse>(
    "/admin/import/commit",
    { method: "POST", body: JSON.stringify({ rows, include_warnings: includeWarnings }) },
    { accessToken }
  );
}
