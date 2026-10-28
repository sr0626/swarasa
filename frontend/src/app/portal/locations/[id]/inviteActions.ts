"use server";

// Server Actions for the location editor's "Invite a manager" panel — keep the
// Cognito token server-side (httpOnly cookie), re-derive the session on every
// call, and let the backend remain the authority (it checks ownership and
// runs every rule; these actions are a thin bridge). Owner OR admin acting for
// the owner, matching the API (`require_location_owner_or_admin`).
import { ApiError } from "@/lib/api/client";
import {
  createManagerInvite,
  revokeManagerInvite,
} from "@/lib/api/managerInvites";
import { getServerSession } from "@/lib/auth/session";
import { createInviteErrorMessage, validateInviteEmail, normalizeInviteEmail } from "@/lib/manager/invite";
import type { ManagerInviteCreated } from "@/types/managerInvite";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function requireInviter(): Promise<
  { ok: true; accessToken: string } | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  if (session.role !== "owner" && session.role !== "admin") {
    return { ok: false, error: "Only the location's owner can invite managers." };
  }
  return { ok: true, accessToken: session.accessToken };
}

/**
 * POST /locations/{id}/manager-invites. The returned `token` is the only time
 * the link secret exists client-side; the panel builds the link from it and
 * never persists it.
 */
export async function createManagerInviteAction(
  locationId: number,
  email: string
): Promise<ActionResult<ManagerInviteCreated>> {
  const auth = await requireInviter();
  if (!auth.ok) return auth;

  const problem = validateInviteEmail(email);
  if (problem) return { ok: false, error: problem };

  try {
    const invite = await createManagerInvite(
      locationId,
      normalizeInviteEmail(email),
      auth.accessToken
    );
    return { ok: true, data: invite };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, error: createInviteErrorMessage(error.status, error.message) };
    }
    return { ok: false, error: createInviteErrorMessage(null, null) };
  }
}

/** DELETE /locations/{id}/manager-invites/{invite_id}. */
export async function revokeManagerInviteAction(
  locationId: number,
  inviteId: number
): Promise<ActionResult<null>> {
  const auth = await requireInviter();
  if (!auth.ok) return auth;

  try {
    await revokeManagerInvite(locationId, inviteId, auth.accessToken);
    return { ok: true, data: null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof ApiError ? error.message : "Could not revoke this invitation.",
    };
  }
}
