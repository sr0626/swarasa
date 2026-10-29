// Server-side loader for the admin menu's Work queue badges. Best-effort by
// contract: any failure (timeout, 5xx, cold database, bad payload) returns
// `null`, and the menu renders exactly as it would without badges -- no error,
// no placeholder. Used by the admin layout / account page (initial render) and
// by the refresh Server Action (lib/actions/adminQueueCounts.ts).
import { getAdminQueueCounts } from "@/lib/api/adminQueueCounts";
import { buildAdminNavBadges, normalizeQueueCounts } from "@/lib/ui/queueBadges";
import type { NavBadges } from "@/lib/ui/queueBadges";

export async function loadAdminNavBadges(accessToken: string): Promise<NavBadges | null> {
  try {
    const counts = normalizeQueueCounts(await getAdminQueueCounts(accessToken));
    return counts === null ? null : buildAdminNavBadges(counts);
  } catch {
    return null;
  }
}
