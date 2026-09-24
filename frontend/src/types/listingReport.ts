// Types for /reports, matching docs/API_CONTRACTS.md "Listing reports
// (`/reports`)" — the public "Report a problem / suggest an update" flow.

export type ReportCategory =
  | "address_incorrect"
  | "hours_incorrect"
  | "phone_incorrect"
  | "price_incorrect"
  | "menu_incorrect"
  | "deal_incorrect"
  | "permanently_closed"
  | "other";

export type ReportStatus = "new" | "resolved" | "dismissed";

/** Body for POST /reports (public). */
export interface CreateReportInput {
  brand_id: number;
  /** Optional; must belong to `brand_id`. */
  location_id?: number;
  category: ReportCategory;
  /** 1-2000 chars. */
  details: string;
  /** Optional contact email for an admin follow-up. */
  reporter_email?: string | null;
  /** Honeypot — always empty from a real user. */
  website?: string;
}

/** Response for POST /reports — identical for stored and honeypot-discarded. */
export interface ReportReceipt {
  status: "received";
}

/** Admin-facing row for GET /reports and PATCH /reports/{id}. */
export interface ListingReport {
  report_id: number;
  brand_id: number;
  brand_name: string;
  brand_slug: string;
  location_id: number | null;
  location_address: string | null;
  category: ReportCategory;
  details: string;
  reporter_email: string | null;
  reporter_user_id: string | null;
  status: ReportStatus;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_notes: string | null;
}

/** Body for PATCH /reports/{id} (admin). */
export interface UpdateReportInput {
  status: ReportStatus;
  reviewer_notes?: string | null;
}
