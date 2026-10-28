"use server";

// Server Actions backing the deal-alerts bell (components/home/
// DealAlertsBell.tsx). Same "keep the Cognito access token server-side"
// rationale as lib/actions/follow.ts: the bell is a Client Component, so it
// never receives `session.accessToken`; these actions re-derive the session
// from the httpOnly cookie. The role check below is a convenience -- the
// backend's `require_registered_user` is the real authority, and every
// backend query is scoped to the caller's own rows.
import { revalidatePath } from "next/cache";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/api/notifications";
import { getServerSession } from "@/lib/auth/session";

type NotificationActionResult = { ok: true } | { ok: false; error: string };

async function requireRegisteredUserToken(): Promise<
  { ok: true; accessToken: string } | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  if (session.role !== "registered_user") {
    return { ok: false, error: "Only registered users have deal alerts." };
  }
  return { ok: true, accessToken: session.accessToken };
}

/** POST /notifications/{id}/read. No revalidation: the caller navigates next, and every
 * page render fetches the bell fresh (`cache: "no-store"`). */
export async function markNotificationReadAction(
  notificationId: number
): Promise<NotificationActionResult> {
  const auth = await requireRegisteredUserToken();
  if (!auth.ok) return auth;
  try {
    await markNotificationRead(notificationId, auth.accessToken);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update this alert. Please try again." };
  }
}

/** POST /notifications/read-all. Revalidates the layout so every cached page's bell refreshes. */
export async function markAllNotificationsReadAction(): Promise<NotificationActionResult> {
  const auth = await requireRegisteredUserToken();
  if (!auth.ok) return auth;
  try {
    await markAllNotificationsRead(auth.accessToken);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not mark alerts as read. Please try again." };
  }
}
