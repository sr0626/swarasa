"use server";

// Server Action backing CreateBrandForm.tsx ("Add your restaurant") — same
// "keep the Cognito session token server-side" rationale as
// app/claim/actions.ts and app/portal/locations/[id]/actions.ts. POST
// /restaurants and POST /locations are owner-only (docs/API_CONTRACTS.md),
// re-checked here even though the backend enforces it too.
//
// One submit creates a usable listing in up to three steps:
//   1. POST /restaurants  (the brand — name, description, website)
//   2. geocode the address (US Census, Nominatim fallback: lib/geocode). Done HERE
//      because the API Lambda has no internet access (no NAT Gateway), so
//      it cannot geocode. Best-effort: never blocks creation.
//   3. POST /locations    (the first location — address, phone, timezone,
//      the cuisine tags picked in the form — they are per LOCATION — and lat/lng
//      when geocoding succeeded; the backend syncs the PostGIS
//      `geom` column search queries from them on create). Steps 2-3 live in
//      lib/portal/createLocationStep.ts, shared with the "Add location" flow.
//
// The new listing starts hidden (`coming_soon`, set by the backend) until the
// owner adds their hours and activates it from the location editor.
//
// Partial failure: if step 1 succeeds and step 3 fails, the brand exists
// but has no location. The result carries `brandId` so the form can retry
// ONLY the location step (`existingBrandId`) instead of creating a
// duplicate brand.
import { createRestaurant } from "@/lib/api/restaurants";
import { getServerSession } from "@/lib/auth/session";
import {
  apiMessageFor as messageFor,
  geocodeAndCreateLocation,
  type MapPosition,
} from "@/lib/portal/createLocationStep";
import { fieldErrorsFromZod, type FieldErrors } from "@/lib/validation/fieldErrors";
import { addRestaurantSchema } from "@/lib/validation/restaurant";

export type AddRestaurantResult =
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
  | {
      ok: false;
      error: string;
      fieldErrors?: FieldErrors;
      /** Set when the brand was created (or already existed) but the location step failed. */
      brandId?: number;
    };

export async function addRestaurantAction(
  input: unknown,
  existingBrandId?: number
): Promise<AddRestaurantResult> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  if (session.role !== "owner") {
    return { ok: false, error: "Only an owner account can add a restaurant." };
  }

  const parsed = addRestaurantSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields and try again.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }
  const values = parsed.data;

  let brandId: number;
  if (existingBrandId !== undefined) {
    // Retry of the location step after a partial failure. The id is
    // client-supplied, so it's untrusted: POST /locations re-checks that
    // the brand belongs to this owner (403/404 otherwise).
    if (!Number.isInteger(existingBrandId) || existingBrandId <= 0) {
      return { ok: false, error: "Something went wrong. Please try again." };
    }
    brandId = existingBrandId;
  } else {
    try {
      const brand = await createRestaurant(
        {
          name: values.name,
          description: values.description,
          website: values.website,
        },
        session.accessToken
      );
      brandId = brand.id;
    } catch (error) {
      return {
        ok: false,
        error: messageFor(error, "Something went wrong creating your restaurant."),
      };
    }
  }

  const created = await geocodeAndCreateLocation(
    brandId,
    {
      address_line1: values.address_line1,
      address_line2: values.address_line2,
      city: values.city,
      state: values.state,
      postal_code: values.postal_code,
      phone: values.phone,
      // Tags describe the first LOCATION (per-location tags), so they ride on POST /locations.
      cuisine_tag_ids: values.cuisine_tag_ids,
    },
    session.accessToken
  );
  if (created.ok) {
    return { ok: true, locationId: created.locationId, mapPosition: created.mapPosition };
  }
  return {
    ok: false,
    brandId,
    error: `Your restaurant was created, but we couldn't save its address. ${created.error}`,
  };
}
