// Types for `restaurant_location` and its sub-resources (hours, photos),
// matching docs/API_CONTRACTS.md "Locations (`restaurant_location`)".
import type { ConsoleTodayStatus } from "@/lib/consoleLocationStatus";

/** 0=Monday..6=Sunday, per docs/API_CONTRACTS.md GET /locations/{id} notes. */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface LocationHour {
  day_of_week: DayOfWeek;
  open_time?: string;
  close_time?: string;
  /** null = "hours unknown" (day never seeded), never guessed. */
  is_closed: boolean | null;
}

/** One entry from the sub-resource endpoints under /locations/{id}/photos. */
export interface GalleryPhoto {
  id: number;
  url: string;
  display_order: number;
}

/** Summary shape from GET /restaurants/{id}/locations. */
export interface LocationSummary {
  id: number;
  location_name: string | null;
  address_line1: string;
  city: string;
  state: string;
  postal_code: string;
  // Genuinely nullable on the backend (restaurant_location.phone) — found
  // live 2026-09-18 alongside the same bug on RestaurantBrand.description.
  phone: string | null;
  is_verified: boolean;
  is_paid: boolean;
  /**
   * FLAGGED CONTRACT GAP (found 2026-09-17 building the owner dashboard's
   * tier/status columns — docs/PROJECT_PLAN.csv "Owner dashboard: richer
   * restaurant table"): `paid_until` is a stored `restaurant_location`
   * column (docs/DATA_MODEL.md, root CLAUDE.md "Tier model") but is not
   * yet serialized by `GET /restaurants/{id}/locations` or
   * `GET /locations/{id}` — `LocationSummaryOut`/`LocationOut`
   * (backend/app/schemas/restaurant.py, backend/app/schemas/location.py)
   * both omit it. Declared here as optional so the dashboard renders it
   * the moment Backend adds it, with no further frontend change —
   * `undefined` in every real response today.
   */
  paid_until?: string | null;
  /**
   * Same contract gap as `paid_until` above — also a stored column, also
   * not yet serialized by either location response schema. Additionally,
   * `list_locations_for_brand` (backend/app/services/location_service.py)
   * filters to `is_active == True` only, so a deactivated location is
   * excluded from this list entirely today, not just missing this field.
   * `undefined`/always-true in practice until Backend closes both gaps.
   */
  is_active?: boolean;
  /** true / false / null (hours unknown) — a display lookup, never a filter. */
  is_open_now: boolean | null;
}

/**
 * Presentation-only pairing used by the owner dashboard: a location plus
 * its actively assigned managers. Not an API response shape itself —
 * managers are fetched separately per location via
 * `GET /locations/{id}/managers` (the location list endpoints don't
 * inline manager rows).
 *
 * `todayStatus` is likewise derived client-side, not an API field —
 * `GET /restaurants/{id}/locations` only serializes `is_open_now` (no
 * today's open/close breakdown, see docs/API_CONTRACTS.md
 * "Summary shape only"), so `lib/owner/loadOwnerRestaurants.ts` fetches each
 * location's full hours via `GET /locations/{id}` and computes it with
 * `lib/consoleLocationStatus.ts`'s `describeConsoleTodayStatus`.
 */
export interface LocationWithManagers {
  location: LocationSummary;
  managers: LocationManager[];
  managersError: string | null;
  todayStatus: ConsoleTodayStatus;
}

/** Full detail shape from GET /locations/{id}. */
export interface LocationDetail {
  id: number;
  brand_id: number;
  // Added: the location editor had no way to show the restaurant's actual
  // name when location_name (an optional per-location label) is unset --
  // it fell back to the raw street address instead. See
  // backend/app/schemas/location.py LocationOut.brand_name.
  brand_name: string;
  location_name: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  phone: string | null;
  /** Owner/manager-authored "about / we specialize in ..." text (max 1000 chars); null until set. */
  about: string | null;
  /** Short specialty chips (max 8, each 1-40 chars); null until set. */
  specialties: string[] | null;
  timezone: string;
  /** null when the listing has never been geocoded (e.g. no geocoder match). */
  latitude: number | null;
  longitude: number | null;
  is_verified: boolean;
  is_paid: boolean;
  is_open_now: boolean | null;
  hours: LocationHour[];
  cover_photo_url: string | null;
  /** Up to 2 entries when is_paid=false, up to 10 when is_paid=true. */
  gallery_photos: GalleryPhoto[];
}

/** Body for POST /locations. */
export interface CreateLocationInput {
  brand_id: number;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  // Required as of 2026-09-22 (docs/PROJECT_PLAN.csv "Make location phone
  // required") — same standing as address_line1/city. `LocationSummary`/
  // `LocationDetail`/`ManagedLocation` below stay `string | null`: those
  // are read shapes and existing seeded/imported rows can still have
  // `phone IS NULL` (not backfilled, see
  // backend/app/schemas/location.py LocationCreate.phone's note) — only
  // the write shape here tightens.
  phone: string;
  timezone: string;
  /** null/omitted when the address couldn't be geocoded — the listing then
   * stays out of geo search until an admin sets a position. */
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Body for PATCH /locations/{id}. Any subset of the address/contact/timezone
 * fields — deliberately excludes is_paid, paid_until, stripe_sub_item_id,
 * which are Stripe-webhook/admin-only writes (docs/API_CONTRACTS.md).
 * `phone` becomes optional-to-omit here (via `Partial`) but, per
 * backend/app/schemas/location.py LocationUpdate.phone, if the key IS
 * sent it still can't be empty/null — omission is the only way to leave
 * it untouched, unlike `about`/`specialties` below which null/empty
 * explicitly clears.
 */
export type UpdateLocationInput = Partial<
  Omit<CreateLocationInput, "brand_id">
> & {
  /** null / "" clears the stored value (unlike the other fields). */
  about?: string | null;
  /** null / [] clears the stored value. */
  specialties?: string[] | null;
};

/** Body for PUT /locations/{id}/hours. */
export interface UpdateLocationHoursInput {
  hours: Array<{
    day_of_week: DayOfWeek;
    open_time?: string;
    close_time?: string;
    is_closed: boolean | null;
  }>;
}

export interface UpdateLocationHoursResponse {
  hours: LocationHour[];
}

/** Body for POST /locations/{id}/photos/upload-url. */
export interface PhotoUploadUrlInput {
  content_type: string;
}

export interface PhotoUploadUrlResponse {
  upload_url: string;
  s3_key: string;
  expires_in: number;
}

/** Body for POST /locations/{id}/photos. */
export interface CreatePhotoInput {
  s3_key: string;
  is_cover: boolean;
}

/** Response shape shared by POST and PATCH /locations/{id}/photos[/{photo_id}]. */
export interface Photo {
  id: number;
  location_id: number;
  url: string;
  is_cover: boolean;
  display_order: number;
}

/** Body for PATCH /locations/{id}/photos/{photo_id}. */
export type UpdatePhotoInput = Partial<Pick<Photo, "display_order" | "is_cover">>;

/**
 * One row from GET/POST /locations/{id}/managers
 * (docs/API_CONTRACTS.md "Location Managers (`location_manager`)").
 * `email` is a read-time-resolved Cognito lookup, not a stored column —
 * `null` if the lookup fails for a since-deleted Cognito user.
 */
export interface LocationManager {
  id: number;
  location_id: number;
  user_id: string;
  email: string | null;
  is_active: boolean;
  assigned_by_owner_id: number;
  assigned_at: string;
  revoked_at: string | null;
}

/** Body for POST /locations/{id}/managers. Identifies the manager by email, not sub. */
export interface AssignLocationManagerInput {
  manager_email: string;
}

/** Response for GET /locations/{id}/managers — no page/page_size/total (bounded list). */
export interface LocationManagersResponse {
  results: LocationManager[];
}

/**
 * One row of `GET /auth/me/managed-locations` (docs/API_CONTRACTS.md,
 * added alongside PR #78). Same field shape as `LocationSummary` above —
 * deliberately duplicated, not reused, matching the backend's own
 * `ManagedLocationOut` (`backend/app/schemas/location_manager.py`): this is
 * a different sub-resource (a manager's own assignments, self-scoped off
 * `/auth/me`) and the two lists are free to diverge later.
 */
export interface ManagedLocation {
  id: number;
  location_name: string | null;
  address_line1: string;
  city: string;
  state: string;
  postal_code: string;
  phone: string | null;
  is_verified: boolean;
  is_paid: boolean;
  is_open_now: boolean | null;
}
