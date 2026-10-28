// Typed client for manager invite-by-email — docs/API_CONTRACTS.md
// "Manager invites". The owner-side calls run in Server Actions (the Cognito
// token is in an httpOnly cookie); the preview is public (the token IS the
// credential) and goes in the POST body, never the URL, so it stays out of
// access logs.
import { apiFetch, toQueryString } from "./client";
import type {
  ManagerInvite,
  ManagerInviteAccepted,
  ManagerInviteCreated,
  ManagerInviteList,
  ManagerInvitePreview,
} from "@/types/managerInvite";

/**
 * POST /locations/{id}/manager-invites — auth: owner of the location, or
 * admin on their behalf. No email is sent (SES deferred); the response's
 * `token` is the only time the link secret is available.
 */
export async function createManagerInvite(
  locationId: number,
  email: string,
  accessToken: string
): Promise<ManagerInviteCreated> {
  return apiFetch<ManagerInviteCreated>(
    `/locations/${locationId}/manager-invites`,
    { method: "POST", body: JSON.stringify({ email }) },
    { accessToken }
  );
}

/** GET /locations/{id}/manager-invites — outstanding (pending + expired) invites. */
export async function getManagerInvites(
  locationId: number,
  accessToken: string,
  pageSize: number = 50
): Promise<ManagerInviteList> {
  return apiFetch<ManagerInviteList>(
    `/locations/${locationId}/manager-invites${toQueryString({ page: 1, page_size: pageSize })}`,
    { method: "GET" },
    { accessToken }
  );
}

/** DELETE /locations/{id}/manager-invites/{invite_id} — 204, idempotent. */
export async function revokeManagerInvite(
  locationId: number,
  inviteId: number,
  accessToken: string
): Promise<void> {
  return apiFetch<void>(
    `/locations/${locationId}/manager-invites/${inviteId}`,
    { method: "DELETE" },
    { accessToken }
  );
}

/**
 * POST /manager-invites/preview — public. Any unusable token (unknown,
 * expired, revoked, used) is the same generic 404 (`ApiError`).
 */
export async function previewManagerInvite(token: string): Promise<ManagerInvitePreview> {
  return apiFetch<ManagerInvitePreview>("/manager-invites/preview", {
    method: "POST",
    body: JSON.stringify({ token }),
    cache: "no-store",
  });
}

/** POST /manager-invites/accept — auth: any signed-in diner/manager whose email matches. */
export async function acceptManagerInvite(
  token: string,
  accessToken: string
): Promise<ManagerInviteAccepted> {
  return apiFetch<ManagerInviteAccepted>(
    "/manager-invites/accept",
    { method: "POST", body: JSON.stringify({ token }) },
    { accessToken }
  );
}

export type { ManagerInvite };
