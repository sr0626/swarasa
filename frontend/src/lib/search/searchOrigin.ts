// Pure rules for WHERE a search is measured from (no React, no fetching).
//
// Precedence, highest first:
//   1. An explicit location the visitor typed (`?location=`) -- geocoded by
//      SearchResults; the saved ZIP is never consulted.
//   2. A signed-in diner's SAVED city + ZIP (user_profile via GET /auth/me) --
//      sent to GET /search as `near_zip`/`near_city`, which the backend turns
//      into a centroid of our own listings (no geocoding vendor).
//   3. Nothing -- the backend's DFW default, exactly as for signed-out visitors.
//
// The saved location only chooses the origin of a search that already has a
// criterion (or the homepage's "Popular near you"); it is never itself a
// criterion, so /search stays empty-by-default (see `hasSearchCriteria`).

export interface SavedLocation {
  city?: string | null;
  postal_code?: string | null;
}

export type SearchOrigin =
  | { kind: "explicit" }
  | { kind: "saved"; nearZip: string; nearCity: string; label: string }
  | { kind: "default" };

/** Five-digit ZIP of a saved "12345" / "12345-6789" value. */
export function zip5(postalCode: string): string {
  return postalCode.trim().slice(0, 5);
}

export function resolveSearchOrigin({
  explicitLocation,
  saved,
}: {
  /** The `?location=` text, if any. */
  explicitLocation?: string | null;
  saved?: SavedLocation | null;
}): SearchOrigin {
  if (explicitLocation?.trim()) return { kind: "explicit" };
  const city = saved?.city?.trim() ?? "";
  const postal = saved?.postal_code?.trim() ?? "";
  // Both halves are mandatory for a diner (same rule as hasLocation()).
  if (!city || !postal) return { kind: "default" };
  const nearZip = zip5(postal);
  return { kind: "saved", nearZip, nearCity: city, label: `ZIP ${nearZip}` };
}

/** The `/search` API params for an origin (empty unless the saved location applies). */
export function originSearchParams(origin: SearchOrigin): { near_zip?: string; near_city?: string } {
  return origin.kind === "saved" ? { near_zip: origin.nearZip, near_city: origin.nearCity } : {};
}

/** Note for the empty /search page (no criteria yet): where a search will start. */
export function idleOriginNote(origin: SearchOrigin): string | null {
  return origin.kind === "saved" ? `Searches start near ${origin.label}` : null;
}

/**
 * Text for the "Searching near ..." note, or null when it should not show.
 * `originSource` is the API's `origin_source`: when our data could not place
 * the saved ZIP/city ("default") the note says so instead of claiming a place
 * the results were not actually measured from.
 */
export function originNote(
  origin: SearchOrigin,
  originSource?: string | null
): { text: string; resolved: boolean } | null {
  if (origin.kind !== "saved") return null;
  if (originSource === "default") {
    return {
      text: `We couldn't place ${origin.label}, so results are around Dallas–Fort Worth`,
      resolved: false,
    };
  }
  return { text: `Searching near ${origin.label}`, resolved: true };
}
