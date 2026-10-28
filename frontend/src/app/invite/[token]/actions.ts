"use server";

// Server Action behind the invite acceptance page: the Cognito token lives in
// an httpOnly cookie the browser can't read, so the accept call runs here. The
// invite token comes from the client (it was in the URL the invitee opened),
// the identity comes only from the session cookie.
import { ApiError } from "@/lib/api/client";
import { acceptManagerInvite } from "@/lib/api/managerInvites";
import { getServerSession } from "@/lib/auth/session";
import { acceptInviteErrorMessage, isPlausibleInviteToken } from "@/lib/manager/invite";
import type { ManagerInviteAccepted } from "@/types/managerInvite";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function acceptManagerInviteAction(
  token: string
): Promise<ActionResult<ManagerInviteAccepted>> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  if (!isPlausibleInviteToken(token)) {
    return { ok: false, error: acceptInviteErrorMessage(404, null) };
  }

  try {
    const accepted = await acceptManagerInvite(token, session.accessToken);
    return { ok: true, data: accepted };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, error: acceptInviteErrorMessage(error.status, error.message) };
    }
    return { ok: false, error: acceptInviteErrorMessage(null, null) };
  }
}
