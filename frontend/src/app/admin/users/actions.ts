"use server";

// Server Action behind the admin Users page (AdminUsersPanel.tsx) -- keeps
// the Cognito access token server-side, same rationale as
// admin/reports/actions.ts. Re-checks `role === "admin"` from the verified
// session on every call, since a Server Action is a real network endpoint
// callable on its own, independent of the page's requireSession gate. The
// backend re-validates everything (self / last-admin guards included).
import { ApiError } from "@/lib/api/client";
import { runAdminUserAction } from "@/lib/api/adminUsers";
import { actionErrorMessage } from "@/lib/adminUsersView";
import { getServerSession } from "@/lib/auth/session";
import type { AdminUserAction, AdminUserActionResult } from "@/types/adminUsers";

export type AdminUserActionOutcome =
  | { ok: true; result: AdminUserActionResult }
  | { ok: false; error: string };

const ACTIONS: readonly AdminUserAction[] = ["disable", "enable", "confirm", "reset-password"];
const USERNAME_PATTERN = /^[A-Za-z0-9._@+-]{1,128}$/;

/** POST /admin/users/{username}/{action} -- auth: admin. */
export async function adminUserAction(
  username: string,
  action: AdminUserAction
): Promise<AdminUserActionOutcome> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  if (session.role !== "admin") {
    return { ok: false, error: "Only admins can manage users." };
  }
  if (!ACTIONS.includes(action) || !USERNAME_PATTERN.test(username)) {
    return { ok: false, error: "That request isn't valid." };
  }

  try {
    const result = await runAdminUserAction(username, action, session.accessToken);
    return { ok: true, result };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, error: actionErrorMessage(error.status, error.message) };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
