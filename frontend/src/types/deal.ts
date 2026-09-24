// Types for `deal` — docs/API_CONTRACTS.md "Deals (`deal`)", matching
// backend/app/schemas/deal.py exactly (PR #185).
//
// Two independent axes, per backend/app/models/deal.py's module docstring:
// `deal_type` ("deal" | "special") is purely descriptive/display metadata;
// `applicable_days` (0=Monday..6=Sunday, same convention as
// `LocationHour.day_of_week` in @/types/location) is the only thing that
// actually restricts which days a deal shows — `null`/omitted means every
// day.
import type { DayOfWeek } from "./location";

export type DealType = "deal" | "special";

/** Full deal content — management view only (owner/manager/admin on the
 * `/locations/{id}/deals` CRUD endpoints). Never the shape returned to a
 * public/anonymous or non-owning caller; see `DealPublic` for that. */
export interface Deal {
  id: number;
  location_id: number;
  deal_type: DealType;
  title: string;
  description: string | null;
  /** null = every day. A non-null list is 0=Monday..6=Sunday, never empty
   * (the backend rejects `[]` — send null/omit for "every day" instead). */
  applicable_days: DayOfWeek[] | null;
  /** ISO 8601 timestamps. null start_at = active immediately; null end_at =
   * runs indefinitely until deactivated. */
  start_at: string | null;
  end_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DealListResponse {
  results: Deal[];
}

/** Content-gated public shape — see backend/app/schemas/deal.py
 * `DealPublicOut`. Only ever populated for a caller who passes
 * `deal_service.caller_may_view_deal_content_for_location` (a signed-in
 * registered_user, admin, or the location's own owner/manager). Deliberately
 * narrower than `Deal`: no `location_id`/`is_active`/timestamps — a public
 * reader doesn't need them, every deal in this list already matched "today"
 * by construction. */
export interface DealPublic {
  id: number;
  deal_type: DealType;
  title: string;
  description: string | null;
}

/** Content-gated shape of one entry in `LocationDetail.upcoming_deals` —
 * backend/app/schemas/deal.py `DealUpcomingOut`. An ACTIVE, not-yet-expired
 * deal that does NOT apply today (another weekday, or a future start date).
 * Same visibility gate as `DealPublic`. */
export interface DealUpcoming {
  id: number;
  deal_type: DealType;
  title: string;
  description: string | null;
  /** null = every day; else 0=Monday..6=Sunday. */
  applicable_days: DayOfWeek[] | null;
  /** ISO instants. null end_at = ongoing. */
  start_at: string | null;
  end_at: string | null;
  /** "YYYY-MM-DD" in the LOCATION's timezone — the next date the deal is
   * offered; the list arrives sorted by it, soonest first. */
  next_occurrence: string;
}

/** Body for POST /locations/{id}/deals. */
export interface CreateDealInput {
  deal_type: DealType;
  title: string;
  description: string | null;
  applicable_days: DayOfWeek[] | null;
  /** Required for a new deal (backend rejects null with 422). */
  start_at: string | null;
  /** Required unless `ongoing` is true. */
  end_at: string | null;
  /** Request-only flag (never returned): explicit "no end date". Required
   * to send `end_at: null`; the server rejects `ongoing: true` together
   * with an `end_at`. */
  ongoing?: boolean;
  is_active: boolean;
}

/**
 * Body for PATCH /locations/{id}/deals/{deal_id}. Same `exclude_unset`
 * convention as `UpdateLocationInput` — an omitted key leaves the stored
 * value untouched; an explicit `null` on a nullable field
 * (description/applicable_days/start_at/end_at) clears it.
 * `title`/`deal_type`/`is_active` are non-nullable on the model, so the
 * client never sends `null` for those (enforced by the form, not the type
 * system — see lib/validation/deal.ts).
 */
export type UpdateDealInput = Partial<CreateDealInput>;
