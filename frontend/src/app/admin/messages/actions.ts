"use server";

// Server Action backing the admin inbox (AdminMessagesPanel.tsx) — same
// "keep the Cognito access token server-side, re-check the admin role" shape
// as admin/reports/actions.ts.
import { ApiError } from "@/lib/api/client";
import { updateAdminMessage } from "@/lib/api/adminMessages";
import { getServerSession } from "@/lib/auth/session";
import type { AdminMessage, AdminMessageStatus } from "@/types/adminMessage";

export type UpdateMessageActionResult =
  | { ok: true; message: AdminMessage }
  | { ok: false; error: string };

/** PATCH /admin/messages/{id} — auth: admin. */
export async function updateMessageStatusAction(
  messageId: number,
  status: AdminMessageStatus
): Promise<UpdateMessageActionResult> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  if (session.role !== "admin") {
    return { ok: false, error: "Only admins can manage messages." };
  }
  if (status !== "open" && status !== "resolved") {
    return { ok: false, error: "Unknown message status." };
  }

  try {
    const message = await updateAdminMessage(messageId, status, session.accessToken);
    return { ok: true, message };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) {
        return { ok: false, error: "That message no longer exists." };
      }
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
