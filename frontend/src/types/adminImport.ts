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
  /** Optional opening hours, e.g. "Mon-Fri 11:00-22:00; Sat 11:00-23:00; Sun closed". */
  hours?: string | null;
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
  /**
   * Importable rows only: what is still needed before the (always hidden)
   * imported listing can be activated — any of name | address | phone | hours.
   * Empty = ready to activate once reviewed.
   */
  missing: string[];
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
  /** Importable rows (ready or warning) that will have nothing missing / still be missing something. */
  ready_to_activate: number;
  incomplete: number;
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
  /** Created rows: always "coming_soon" (hidden). Null for rows that were not created. */
  listing_status: string | null;
  /** Created rows: what is still needed before activation (empty = ready to activate). */
  missing: string[];
}

export interface CommitSummary {
  created: number;
  skipped_duplicate: number;
  skipped_warning: number;
  failed: number;
  needs_geocoding: number;
  /** Of `created` (all hidden): nothing missing vs still missing something. */
  created_ready_to_activate: number;
  created_incomplete: number;
}

export interface CommitResponse {
  rows: CommittedRow[];
  summary: CommitSummary;
}
