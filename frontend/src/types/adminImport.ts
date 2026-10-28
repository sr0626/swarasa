// Types for the admin bulk listing import — POST /admin/import/validate and
// POST /admin/import/commit. Mirrors backend/app/schemas/admin_import.py
// (docs/API_CONTRACTS.md "Admin bulk listing import").

/** One CSV row as sent to the API. `row_number` is the spreadsheet row (header = 1). */
export interface ImportRowInput {
  row_number: number;
  name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  phone?: string | null;
  website?: string | null;
  type?: string | null;
  description?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
}

export type ImportRowStatus = "valid" | "warning" | "error" | "duplicate";
export type ImportIssueSeverity = "error" | "warning" | "info";

export interface ImportIssue {
  field: string | null;
  severity: ImportIssueSeverity;
  code: string;
  message: string;
}

export interface ValidatedRow {
  row_number: number;
  name: string;
  status: ImportRowStatus;
  issues: ImportIssue[];
  needs_geocoding: boolean;
  matched_tag: string | null;
  duplicate_of_row: number | null;
  duplicate_of_listing_id: number | null;
}

export interface ValidateSummary {
  total: number;
  valid: number;
  warning: number;
  error: number;
  duplicate: number;
  needs_geocoding: number;
}

export interface ValidateResponse {
  rows: ValidatedRow[];
  summary: ValidateSummary;
}

export type CommitResult = "created" | "skipped_duplicate" | "skipped_warning" | "failed";

export interface CommittedRow {
  row_number: number;
  name: string;
  result: CommitResult;
  reason: string | null;
  brand_id: number | null;
  location_id: number | null;
  needs_geocoding: boolean;
}

export interface CommitSummary {
  created: number;
  skipped_duplicate: number;
  skipped_warning: number;
  failed: number;
  needs_geocoding: number;
}

export interface CommitResponse {
  rows: CommittedRow[];
  summary: CommitSummary;
}
