// Pure helpers for the location editor's map position. Latitude/longitude are
// AUTO-GENERATED from the address (user decision 2026-09-24): never hand-edited
// in the form, re-geocoded server-side (lib/geocode; the API Lambda has no
// internet) whenever the street/city/state/ZIP change or the listing has no
// position yet. Unit tests: locationCoordinates.test.ts.

export interface AddressFields {
  address_line1: string;
  city: string;
  state: string;
  postal_code: string;
}

/**
 * True when the geocodable address differs. `address_line2` (suite/unit) is
 * deliberately not compared: the geocoder strips unit tokens anyway, so a
 * suite change can't move the pin and shouldn't trigger a lookup (or a
 * spurious "couldn't update" notice).
 */
export function addressChanged(a: AddressFields, b: AddressFields): boolean {
  return (
    a.address_line1.trim() !== b.address_line1.trim() ||
    a.city.trim() !== b.city.trim() ||
    a.state.trim().toUpperCase() !== b.state.trim().toUpperCase() ||
    a.postal_code.trim() !== b.postal_code.trim()
  );
}

/** Re-geocode on an address change, or when there is no stored position yet. */
export function needsRegeocode(
  next: AddressFields,
  saved: AddressFields,
  hasStoredPosition: boolean
): boolean {
  return addressChanged(next, saved) || !hasStoredPosition;
}

/**
 * Muted read-only line shown in place of the old latitude/longitude inputs.
 * Six decimals are stored; two are plenty to read ("32.85, -96.97").
 */
export function describeMapPosition(
  latitude: number | null | undefined,
  longitude: number | null | undefined
): string {
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return "Map position: not set yet — it is set automatically when you save the address.";
  }
  return `Map position: ${latitude.toFixed(2)}, ${longitude.toFixed(2)} — updated automatically from the address.`;
}

/** Shown after a save whose address changed but couldn't be placed on the map. */
export const MAP_POSITION_NOT_UPDATED_NOTICE =
  "Saved. We couldn't update the map position for this address, so the previous position was kept; an admin can fix it.";
