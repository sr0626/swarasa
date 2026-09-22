// Typed client for /auth — docs/API_CONTRACTS.md "Auth (`/auth`)", plus its
// `/auth/me/*` sub-resources (managed-locations, follows, CCPA data
// export/deletion) added here for the account/profile page — none of them
// had a typed client function before (root CLAUDE.md "All API calls go
// through typed functions").
import { apiFetch, toQueryString } from "./client";
import type { PaginatedResponse, PaginationParams } from "@/types/common";
import type {
  AuthMe,
  UpdateAuthMeInput,
  UpdateMyProfileInput,
  UpdateMyProfileResult,
} from "@/types/auth";
import type { FollowedBrand } from "@/types/follow";
import type { ManagedLocation } from "@/types/location";
import type {
  CreateDataDeletionInput,
  DataDeletionRequest,
  DataExport,
} from "@/types/privacy";

/** GET /auth/me — auth: any authenticated user. */
export async function getCurrentUser(accessToken: string): Promise<AuthMe> {
  return apiFetch<AuthMe>(
    "/auth/me",
    { method: "GET" },
    { accessToken }
  );
}

/**
 * PATCH /auth/me — full_name + phone, backing `ProfileEditForm`
 * (owner-only in practice today). The route itself accepts any authenticated
 * role (`update_me` in backend/app/routers/auth.py takes `get_current_user`,
 * not `require_owner` — broadened in PR #83), but `owner_account` is still
 * the only local record with a `phone` field, so a manager/admin/
 * registered_user caller gets `404 no_editable_profile`, not the `403` an
 * older version of this comment claimed. Fixed here while adding
 * `updateMyProfile` below for the roles that DO have something to submit
 * (name only, no phone) — see that function's comment.
 */
export async function updateCurrentUser(
  input: UpdateAuthMeInput,
  accessToken: string
): Promise<AuthMe["owner_account"]> {
  return apiFetch<AuthMe["owner_account"]>(
    "/auth/me",
    { method: "PATCH", body: JSON.stringify(input) },
    { accessToken }
  );
}

/**
 * PATCH /auth/me — name-only variant for roles with no `owner_account` row
 * (manager, registered_user). Manager wiring: components/account/
 * NameEditForm.tsx via `app/account/actions.ts`'s `updateMyNameAction`,
 * added for the manager console redesign (this PR).
 *
 * CROSS-PR DEPENDENCY (flagged in this PR's description): today,
 * `auth_service.update_me` still 404s (`no_editable_profile`) for every
 * role except owner — there is no local table to persist a manager's or
 * registered_user's name yet. A companion PR ("registered-user editable
 * name", dispatched separately/in parallel) owns adding that persistence on
 * the backend, for both roles at once, to avoid two competing schema
 * changes for the same gap. Until that PR merges, calling this function
 * from a manager session will 404 — expected, not a bug in this PR. Once it
 * merges, this call starts succeeding with no frontend change needed here,
 * since it already hits the real `PATCH /auth/me` route with the
 * `{"full_name": "..."}` body shape that PR was asked to support.
 */
export async function updateMyProfile(
  input: UpdateMyProfileInput,
  accessToken: string
): Promise<UpdateMyProfileResult> {
  return apiFetch<UpdateMyProfileResult>(
    "/auth/me",
    { method: "PATCH", body: JSON.stringify(input) },
    { accessToken }
  );
}

/**
 * GET /auth/me/follows — auth: registered_user
 * (`require_registered_user` in backend/app/routers/auth.py).
 */
export async function getMyFollows(
  params: PaginationParams,
  accessToken: string
): Promise<PaginatedResponse<FollowedBrand>> {
  const query = toQueryString({ page: params.page, page_size: params.page_size });
  return apiFetch<PaginatedResponse<FollowedBrand>>(
    `/auth/me/follows${query}`,
    { method: "GET" },
    { accessToken }
  );
}

/**
 * GET /auth/me/managed-locations — auth: any authenticated user, inherently
 * self-scoped to the caller's own active `location_manager` rows (added
 * alongside PR #78, docs/API_CONTRACTS.md "GET /auth/me/managed-locations").
 */
export async function getMyManagedLocations(
  params: PaginationParams,
  accessToken: string
): Promise<PaginatedResponse<ManagedLocation>> {
  const query = toQueryString({ page: params.page, page_size: params.page_size });
  return apiFetch<PaginatedResponse<ManagedLocation>>(
    `/auth/me/managed-locations${query}`,
    { method: "GET" },
    { accessToken }
  );
}

/**
 * GET /auth/me/data-export — auth: any authenticated user, own data only.
 * Synchronous — returns the full export as JSON (docs/API_CONTRACTS.md
 * "Privacy (CCPA data export / deletion)"). Read-only: never lazily
 * provisions an owner_account row, unlike GET /auth/me.
 */
export async function exportMyData(accessToken: string): Promise<DataExport> {
  return apiFetch<DataExport>(
    "/auth/me/data-export",
    { method: "GET" },
    { accessToken }
  );
}

/**
 * POST /auth/me/data-deletion — auth: any authenticated user, own data only.
 * Creates a pending admin-reviewed REQUEST, not an immediate deletion — see
 * docs/DECISIONS.md "CCPA data export/deletion". Returns 409 (surfaced as
 * an ApiError with status 409) if a request is already pending.
 */
export async function requestDataDeletion(
  input: CreateDataDeletionInput,
  accessToken: string
): Promise<DataDeletionRequest> {
  return apiFetch<DataDeletionRequest>(
    "/auth/me/data-deletion",
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/** GET /auth/me/data-deletion — auth: any authenticated user, own requests only. */
export async function getMyDataDeletionRequests(
  params: PaginationParams,
  accessToken: string
): Promise<PaginatedResponse<DataDeletionRequest>> {
  const query = toQueryString({ page: params.page, page_size: params.page_size });
  return apiFetch<PaginatedResponse<DataDeletionRequest>>(
    `/auth/me/data-deletion${query}`,
    { method: "GET" },
    { accessToken }
  );
}
