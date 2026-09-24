// Server-side step shared by the two "new listing" flows — "Add restaurant"
// (app/portal/brands/new/actions.ts, brand + first location) and "Add
// location" (app/portal/locations/new/actions.ts, another branch of an
// existing brand): geocode the address, then POST /locations.
//
// Geocoding happens HERE (server side) because the API Lambda has no internet
// access (no NAT Gateway) and so can't. It's best-effort and never blocks
// creation; without coordinates the listing just stays out of geo search until
// an admin sets a position. The created location starts in `coming_soon` (the
// backend decides that — docs/DECISIONS.md "New manual listings start in
// setup"); this helper never sets a status itself.
import { ApiError } from "@/lib/api/client";
import { createLocation } from "@/lib/api/locations";
import { geocodeAddress } from "@/lib/geocode";
import { timezoneForState } from "@/lib/timezone";

export type MapPosition = "exact" | "approximate" | "none";

/** The parsed (post-zod) address + phone fields of a new location. */
export interface NewLocationValues {
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  phone: string;
}

export type CreateLocationStepResult =
  | {
      ok: true;
      locationId: number;
      /**
       * "none": geocoding found nothing, so the listing has no map position
       * (and stays out of geo search) until an admin sets it. "approximate":
       * only the ZIP area matched. "exact": street-level match.
       */
      mapPosition: MapPosition;
    }
  | { ok: false; error: string };

export function apiMessageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export async function geocodeAndCreateLocation(
  brandId: number,
  values: NewLocationValues,
  accessToken: string
): Promise<CreateLocationStepResult> {
  const coordinates = await geocodeAddress({
    address_line1: values.address_line1,
    city: values.city,
    state: values.state,
    postal_code: values.postal_code,
  });

  try {
    const location = await createLocation(
      {
        brand_id: brandId,
        address_line1: values.address_line1,
        address_line2: values.address_line2,
        city: values.city,
        state: values.state,
        postal_code: values.postal_code,
        country: "US",
        phone: values.phone,
        timezone: timezoneForState(values.state),
        // Never fabricated: null when geocoding found nothing.
        latitude: coordinates?.latitude ?? null,
        longitude: coordinates?.longitude ?? null,
      },
      accessToken
    );
    const mapPosition: MapPosition = !coordinates
      ? "none"
      : coordinates.precision === "postal_code"
        ? "approximate"
        : "exact";
    return { ok: true, locationId: location.id, mapPosition };
  } catch (error) {
    return { ok: false, error: apiMessageFor(error, "Please try again.") };
  }
}
