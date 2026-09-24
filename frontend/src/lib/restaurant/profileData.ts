// Server-side helpers shared by the two pages that render a location profile
// (`/restaurant/[brandSlug]` for a single-location brand and
// `/restaurant/[brandSlug]/[locationSlug]`). Moved out of the old
// single-route page unchanged in behaviour.
import { getLocationManagers } from "@/lib/api/locations";
import { getLocationMenu } from "@/lib/api/menu";
import type { Session } from "@/types/auth";
import type { LocationDetail } from "@/types/location";
import type { MenuResponse } from "@/types/menu";

/**
 * Can the signed-in visitor edit this listing? Uses the same access probe the
 * location editor itself uses as its gate (`GET /locations/{id}/managers` --
 * owner of the parent brand, admin, or an actively assigned manager;
 * docs/API_CONTRACTS.md "Location Managers"), so the public page never decides
 * permissions on its own: whatever the editor would allow, and only that,
 * shows the link. Any failure (403, network) is "no" -- the link is a
 * convenience, never a security boundary; the backend re-validates every write.
 */
export async function canEditListing(
  location: LocationDetail | null,
  session: Session | null
): Promise<boolean> {
  if (!location) return false;
  if (!session || !["owner", "manager", "admin"].includes(session.role)) return false;
  try {
    await getLocationManagers(location.id, {}, session.accessToken);
    return true;
  } catch {
    return false;
  }
}

/** The public menu, or null when it can't be loaded — a menu problem must
 * never take the listing page down. The token (when signed in) only matters
 * for the hidden-location owner-preview case, exactly like the location read;
 * anonymous reads use the 60s-cached public GET. */
export async function loadMenuSafely(
  location: LocationDetail | null,
  accessToken?: string
): Promise<MenuResponse | null> {
  if (!location) return null;
  try {
    return await getLocationMenu(location.id, accessToken);
  } catch {
    return null;
  }
}

/** Page `<title>`: "{Brand} — Desi Restaurant in {City}, {State}" (frontend/CLAUDE.md SEO
 * meta title format); no city when the brand has no location. */
export function pageTitle(brandName: string, location: LocationDetail | null): string {
  const cityState = location ? ` in ${location.city}, ${location.state}` : "";
  return `${brandName} — Desi Restaurant${cityState}`;
}

/** Meta description: the brand description (150 chars) or a generic line — descriptions are
 * nullable in practice (every CSV-imported restaurant has none). */
export function pageDescription(
  brandName: string,
  description: string | null,
  location: LocationDetail | null
): string {
  if (description) return description.slice(0, 150);
  return `${pageTitle(brandName, location)} on Swarasa.`;
}
