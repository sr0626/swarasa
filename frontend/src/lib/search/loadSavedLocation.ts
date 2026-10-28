// Server-only: the signed-in diner's SAVED city + ZIP (GET /auth/me), used as
// the default search origin by /search and the homepage's "Popular near you"
// (rules in ./searchOrigin.ts). Null for signed-out visitors and every role
// except registered_user, and on ANY failure -- an enhancement must never
// break or block browsing. `cache()` dedupes the /auth/me call between the
// several server components of one render.
import { cache } from "react";
import { getCurrentUser } from "@/lib/api/auth";
import { getServerSession } from "@/lib/auth/session";
import type { SavedLocation } from "./searchOrigin";

export const loadSavedLocation = cache(async (): Promise<SavedLocation | null> => {
  try {
    const session = await getServerSession();
    if (!session || session.role !== "registered_user") return null;
    const me = await getCurrentUser(session.accessToken);
    return { city: me.city ?? null, postal_code: me.postal_code ?? null };
  } catch {
    return null;
  }
});
