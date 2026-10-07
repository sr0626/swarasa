// Types for "Contact admin" — POST /contact-admin (owner/manager) and the
// admin inbox GET /admin/messages + PATCH /admin/messages/{id}. Mirrors
// backend/app/schemas/admin_message.py (docs/API_CONTRACTS.md "Contact admin").
import type { PaginatedResponse } from "@/types/common";

export type AdminMessageStatus = "open" | "resolved";

/** Server-side bounds, kept here so the form and the server action agree. */
export const SUBJECT_MIN_LENGTH = 3;
export const SUBJECT_MAX_LENGTH = 120;
export const BODY_MIN_LENGTH = 10;
export const BODY_MAX_LENGTH = 4000;
export const MESSAGE_SEARCH_MAX_LENGTH = 100;

/** Body for POST /contact-admin. */
export interface ContactAdminInput {
  subject: string;
  body: string;
  /** Optional: a location the sender owns / is assigned to. */
  related_location_id?: number | null;
}

/** Response for POST /contact-admin. */
export interface ContactAdminReceipt {
  status: "received";
}

/** Admin-facing row for GET /admin/messages and PATCH /admin/messages/{id}. */
export interface AdminMessage {
  message_id: number;
  sender_role: string;
  sender_email: string;
  sender_name: string | null;
  subject: string;
  body: string;
  related_location_id: number | null;
  /** Ready-to-render "Brand — Name, address" text; null when none attached. */
  related_location_label: string | null;
  related_location_brand_slug: string | null;
  related_location_slug: string | null;
  status: AdminMessageStatus;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

/** GET /admin/messages — the page envelope plus the inbox-wide open count. */
export interface AdminMessageListResponse extends PaginatedResponse<AdminMessage> {
  /** Open messages across the whole inbox, independent of filters/page. */
  open_count: number;
}

/** A location the sender may attach — option in the Contact admin dropdown. */
export interface ContactAdminLocationOption {
  id: number;
  label: string;
}
