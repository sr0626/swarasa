// Typed client for /auth — docs/API_CONTRACTS.md "Auth (`/auth`)", plus its
// `/auth/me/*` sub-resources (managed-locations, follows, CCPA data
// export/deletion) added here for the account/profile page — none of them
// had a typed client function before (root CLAUDE.md "All API calls go
// through typed functions").
import { apiFetch, toQueryString } from "./client";
import type { PaginatedResponse, PaginationParams } from "@/types/common";
import type { AuthMe, UpdateAuthMeInput } from "@/types/auth";
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
 * PATCH /auth/me — auth: owner ONLY per the real contract
 * (docs/API_CONTRACTS.md "PATCH /auth/me": "Auth: owner"). Manager, admin,
 * and registered_user callers get a 403 — the account page only renders
 * this as an editable form for an owner session; see its own comment for
 * the full judgment call.
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
