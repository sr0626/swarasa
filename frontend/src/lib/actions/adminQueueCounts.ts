"use server";

// Server Action behind the admin menu's badge refresh (components/console/
// NavBadgesProvider.tsx). The admin layout is not re-rendered on client-side
// navigation between /admin/* pages, so the provider re-fetches through this
// action when the path changes. The Cognito token stays server-side (same
// rationale as lib/actions/notifications.ts); the role check is a convenience
// -- the backend's `require_admin` is the real authority.
import { getServerSession } from "@/lib/auth/session";
import { loadAdminNavBadges } from "@/lib/admin/navBadges";
import type { NavBadges } from "@/lib/ui/queueBadges";

/** Fresh badges, or null when unavailable (the caller keeps what it has). */
export async function refreshAdminNavBadgesAction(): Promise<NavBadges | null> {
  const session = await getServerSession();
  if (!session || session.role !== "admin") return null;
  return loadAdminNavBadges(session.accessToken);
}
