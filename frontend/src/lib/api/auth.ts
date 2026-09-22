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
  UpdateProfileInput,
  UpdateProfileResult,
} from "@/types/auth";
import type { OwnerActivity } from "@/types/activity";
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
 * PATCH /auth/me — generalized display-name update for `registered_user`/
 * `manager` callers (docs/API_CONTRACTS.md "PATCH /auth/me", generalized
 * alongside the new `user_profile` table — see
 * backend/app/models/user_profile.py). Separate from `updateCurrentUser`
 * above (which is owner-only and returns the full `OwnerAccount` shape):
 * this hits the same endpoint but only ever sends/receives `full_name` —
 * the shape a registered_user/manager caller's write actually has. Safe to
 * call for an owner session too (the backend still routes an owner caller
 * to `owner_account`, `phone` simply stays untouched), but owner UI uses
 * `updateCurrentUser` instead so it keeps getting `phone`/`id`/
 * `stripe_customer_id` back.
 */
export async function updateMyProfile(
  input: UpdateProfileInput,
  accessToken: string
): Promise<UpdateProfileResult> {
  return apiFetch<UpdateProfileResult>(
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
 * GET /auth/me/activity — auth: owner only (docs/API_CONTRACTS.md
 * "GET /auth/me/activity"). Owner-scoped read of `audit_log`, including
 * manager edits made on the owner's behalf.
 */
export async function getMyActivity(
  params: PaginationParams,
  accessToken: string
): Promise<PaginatedResponse<OwnerActivity>> {
  const query = toQueryString({ page: params.page, page_size: params.page_size });
  return apiFetch<PaginatedResponse<OwnerActivity>>(
    `/auth/me/activity${query}`,
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
