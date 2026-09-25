// Typed client for /locations (restaurant_location) and its sub-resources
// (hours, photos, managers) — docs/API_CONTRACTS.md "Locations
// (`restaurant_location`)" and "Location Managers (`location_manager`)".
import { apiFetch } from "./client";
import type {
  AssignLocationManagerInput,
  CreateLocationInput,
  CreatePhotoInput,
  LocationCuisineTagsResponse,
  LocationDetail,
  LocationManager,
  LocationManagersResponse,
  Photo,
  PhotoUploadUrlInput,
  PhotoUploadUrlResponse,
  UpdateLocationCuisineTagsInput,
  UpdateLocationHoursInput,
  UpdateLocationHoursResponse,
  UpdateLocationInput,
  UpdateLocationStatusInput,
  UpdatePhotoInput,
} from "@/types/location";

/**
 * GET /locations/{id} — public by default, but caller-aware: a hidden
 * location (any status other than `active`) 404s for anyone without real
 * access, UNLESS `accessToken` is passed AND that caller is the owner,
 * admin, or an assigned manager (see `location_service.get_location` /
 * `_caller_may_view_hidden_location`, backend/app/services/location_service.py).
 * Pass `accessToken` whenever the caller is signed in and might legitimately
 * need to see their own hidden location (the portal location editor, the
 * owner/manager console's own tiles) — omit it for a genuinely public/SSR
 * read (the public restaurant page), where an anonymous 404 on a hidden
 * location is the correct, intended behavior.
 */
export async function getLocationById(
  id: number,
  accessToken?: string
): Promise<LocationDetail> {
  return apiFetch<LocationDetail>(
    `/locations/${id}`,
    { method: "GET" },
    { accessToken, revalidateSeconds: accessToken ? undefined : 60 }
  );
}

/**
 * POST /locations/{id}/status — auth: owner (owns parent brand) or admin,
 * no manager path (docs/PROJECT_PLAN.csv "Location status lifecycle";
 * backend/app/routers/locations.py). The one asymmetric rule (no
 * self-service exit from `closed_pending_reopen`) is enforced server-side —
 * this call 409s the same way any other invalid transition would.
 */
export async function updateLocationStatus(
  id: number,
  input: UpdateLocationStatusInput,
  accessToken: string
): Promise<LocationDetail> {
  return apiFetch<LocationDetail>(
    `/locations/${id}/status`,
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/** POST /locations — auth: owner (must own the parent brand). */
export async function createLocation(
  input: CreateLocationInput,
  accessToken: string
): Promise<LocationDetail> {
  return apiFetch<LocationDetail>(
    "/locations",
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/**
 * PATCH /locations/{id} — auth: owner (owns parent brand) or manager with
 * an active assignment for this location (checked server-side, never from
 * the JWT alone).
 */
export async function updateLocation(
  id: number,
  input: UpdateLocationInput,
  accessToken: string
): Promise<LocationDetail> {
  return apiFetch<LocationDetail>(
    `/locations/${id}`,
    { method: "PATCH", body: JSON.stringify(input) },
    { accessToken }
  );
}

/**
 * PUT /locations/{id}/cuisine-tags — auth: owner (owns parent brand), assigned
 * manager, or admin. Full replace of THIS location's cuisine/dietary tags
 * (tags are per location; docs/API_CONTRACTS.md "PUT /locations/{id}/cuisine-tags").
 */
export async function replaceLocationCuisineTags(
  id: number,
  input: UpdateLocationCuisineTagsInput,
  accessToken: string
): Promise<LocationCuisineTagsResponse> {
  return apiFetch<LocationCuisineTagsResponse>(
    `/locations/${id}/cuisine-tags`,
    { method: "PUT", body: JSON.stringify(input) },
    { accessToken }
  );
}

/**
 * DELETE /locations/{id} — auth: owner (owns parent brand) or admin.
 * Soft delete (sets is_active=false) — see docs/API_CONTRACTS.md.
 */
export async function deleteLocation(
  id: number,
  accessToken: string
): Promise<void> {
  return apiFetch<void>(
    `/locations/${id}`,
    { method: "DELETE" },
    { accessToken }
  );
}

/**
 * DELETE /locations/{id}/permanent — auth: owner (owns parent brand) or
 * admin. Real, irreversible row delete — NOT the soft-hide `deleteLocation`
 * above. Backend guardrails (docs/API_CONTRACTS.md "DELETE
 * /locations/{id}/permanent"): the location must already be non-`active`,
 * have no active manager assignment, and no pending claim or reopen
 * request — each surfaces as its own `409` with a distinct `code`, message
 * passed through as-is by the caller (see `removeLocationAction`).
 */
export async function removeLocationPermanently(
  id: number,
  accessToken: string
): Promise<void> {
  return apiFetch<void>(
    `/locations/${id}/permanent`,
    { method: "DELETE" },
    { accessToken }
  );
}

/** PUT /locations/{id}/hours — full week replacement. */
export async function updateLocationHours(
  id: number,
  input: UpdateLocationHoursInput,
  accessToken: string
): Promise<UpdateLocationHoursResponse> {
  return apiFetch<UpdateLocationHoursResponse>(
    `/locations/${id}/hours`,
    { method: "PUT", body: JSON.stringify(input) },
    { accessToken }
  );
}

/**
 * POST /locations/{id}/photos/upload-url — step 1 of the S3 presigned
 * upload flow (root CLAUDE.md media pattern: presigned URL, never through
 * Lambda). This is a presigned **POST** (not PUT) — the client submits
 * `upload_url` as a multipart form, every entry in `fields` as its own
 * form field plus the file itself under the field name `file` (S3's
 * presigned-POST convention; see docs/API_CONTRACTS.md "POST
 * /locations/{id}/photos/upload-url" for why: only presigned POST can
 * enforce the 5MB `content-length-range` cap). Then calls
 * `createLocationPhoto` below with the same `s3_key`.
 */
export async function getLocationPhotoUploadUrl(
  id: number,
  input: PhotoUploadUrlInput,
  accessToken: string
): Promise<PhotoUploadUrlResponse> {
  return apiFetch<PhotoUploadUrlResponse>(
    `/locations/${id}/photos/upload-url`,
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/** POST /locations/{id}/photos — step 2, records the row after the S3 upload succeeds. */
export async function createLocationPhoto(
  id: number,
  input: CreatePhotoInput,
  accessToken: string
): Promise<Photo> {
  return apiFetch<Photo>(
    `/locations/${id}/photos`,
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/** PATCH /locations/{id}/photos/{photo_id} — reorder or set as cover. */
export async function updateLocationPhoto(
  id: number,
  photoId: number,
  input: UpdatePhotoInput,
  accessToken: string
): Promise<Photo> {
  return apiFetch<Photo>(
    `/locations/${id}/photos/${photoId}`,
    { method: "PATCH", body: JSON.stringify(input) },
    { accessToken }
  );
}

/** DELETE /locations/{id}/photos/{photo_id} — hard row delete. */
export async function deleteLocationPhoto(
  id: number,
  photoId: number,
  accessToken: string
): Promise<void> {
  return apiFetch<void>(
    `/locations/${id}/photos/${photoId}`,
    { method: "DELETE" },
    { accessToken }
  );
}

/**
 * POST /locations/{id}/managers — auth: owner only (must own the parent
 * brand). No admin path, no manager-assigns-manager path — see
 * docs/API_CONTRACTS.md "POST /locations/{id}/managers".
 */
export async function assignLocationManager(
  id: number,
  input: AssignLocationManagerInput,
  accessToken: string
): Promise<LocationManager> {
  return apiFetch<LocationManager>(
    `/locations/${id}/managers`,
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/**
 * GET /locations/{id}/managers — auth: owner (owns parent brand), admin, or
 * a manager with an active assignment on this location. `activeOnly` is
 * forced true server-side for a manager caller regardless of what's passed
 * here (docs/API_CONTRACTS.md).
 */
export async function getLocationManagers(
  id: number,
  params: { activeOnly?: boolean } = {},
  accessToken: string
): Promise<LocationManagersResponse> {
  const query = params.activeOnly ? "?active_only=true" : "";
  return apiFetch<LocationManagersResponse>(
    `/locations/${id}/managers${query}`,
    { method: "GET" },
    { accessToken }
  );
}

/**
 * DELETE /locations/{id}/managers/{manager_id} — auth: owner (owns parent
 * brand) or admin. Soft-deactivate (is_active=false), idempotent — calling
 * again on an already-inactive row still returns 204.
 * `manager_id` is the assignment row's own PK (`location_manager.id`), not
 * the manager's `user_id`.
 */
export async function removeLocationManager(
  id: number,
  managerId: number,
  accessToken: string
): Promise<void> {
  return apiFetch<void>(
    `/locations/${id}/managers/${managerId}`,
    { method: "DELETE" },
    { accessToken }
  );
}
