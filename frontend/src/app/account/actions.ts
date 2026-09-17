"use server";

// Server Actions backing the account page's interactive sections (profile
// edit, CCPA data export, CCPA data-deletion request) — same
// "keep the Cognito access token server-side" rationale as
// frontend/src/app/claim/actions.ts and
// frontend/src/app/portal/locations/[id]/actions.ts. Every action
// independently re-derives the session from the httpOnly cookie (never
// trusts a role passed in from the client). The underlying typed
// /lib/api/auth.ts calls still hit the real backend, which re-validates
// authorization server-side on every call (root CLAUDE.md "Permission
// model") — these actions are a thin, safe bridge, not a second source of
// truth for authorization.
import { ApiError } from "@/lib/api/client";
import {
  exportMyData,
  requestDataDeletion,
  updateCurrentUser,
} from "@/lib/api/auth";
import { getServerSession } from "@/lib/auth/session";
import { requestDataDeletionSchema } from "@/lib/validation/account";
import { updateAuthMeSchema } from "@/lib/validation/auth";
import type { AuthMe } from "@/types/auth";
import type { DataDeletionRequest, DataExport } from "@/types/privacy";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function requireAccountSession(): Promise<
  { ok: true; accessToken: string } | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  return { ok: true, accessToken: session.accessToken };
}

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  return fallback;
}

/**
 * PATCH /auth/me. Owner-only per the real contract (docs/API_CONTRACTS.md
 * "PATCH /auth/me": "Auth: owner") — this action doesn't gate on role
 * itself beyond re-deriving the session, since the backend is the real
 * enforcement point and will 403 a non-owner caller; the account page
 * simply never renders the form that would call this for other roles.
 */
export async function updateProfileAction(
  input: unknown
): Promise<ActionResult<AuthMe["owner_account"]>> {
  const auth = await requireAccountSession();
  if (!auth.ok) return auth;

  const parsed = updateAuthMeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check the form and try again.",
    };
  }

  try {
    const account = await updateCurrentUser(parsed.data, auth.accessToken);
    return { ok: true, data: account };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Something went wrong saving your profile.") };
  }
}

/**
 * GET /auth/me/data-export. Returns the full export object to the client so
 * it can trigger a browser download (Blob + object URL) without the
 * Cognito access token ever reaching client-side JS.
 */
export async function exportMyDataAction(): Promise<ActionResult<DataExport>> {
  const auth = await requireAccountSession();
  if (!auth.ok) return auth;

  try {
    const data = await exportMyData(auth.accessToken);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not generate your data export.") };
  }
}

/**
 * POST /auth/me/data-deletion. Creates a pending admin-reviewed REQUEST,
 * not an immediate deletion (docs/DECISIONS.md "CCPA data export/
 * deletion") — the confirm dialog and copy on the client side must not
 * imply otherwise.
 */
export async function requestDataDeletionAction(
  input: unknown
): Promise<ActionResult<DataDeletionRequest>> {
  const auth = await requireAccountSession();
  if (!auth.ok) return auth;

  const parsed = requestDataDeletionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check the form and try again.",
    };
  }

  try {
    const request = await requestDataDeletion(
      { reason: parsed.data.reason || null },
      auth.accessToken
    );
    return { ok: true, data: request };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return {
        ok: false,
        error: "You already have a deletion request pending review.",
      };
    }
    return { ok: false, error: messageFor(error, "Could not submit your deletion request.") };
  }
}
