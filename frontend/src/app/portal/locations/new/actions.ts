"use server";

// Server Action backing AddLocationForm.tsx ("Add location" — another branch
// of an EXISTING restaurant, so the owner doesn't create a duplicate brand).
// Same "keep the Cognito access token server-side" rationale as
// app/portal/brands/new/actions.ts. POST /locations is owner-of-that-brand or
// admin (docs/API_CONTRACTS.md); a manager can't add locations. The session
// role is re-checked here, and the backend re-checks brand ownership on the
// call itself (403/404 otherwise) — the brand id is client-supplied, so
// untrusted.
//
// Geocoding + POST /locations are the same shared step "Add restaurant" uses
// (lib/portal/createLocationStep.ts); the new location starts hidden
// (`coming_soon`, set by the backend) until its hours are in and it's
// activated from the location editor.
import { getServerSession } from "@/lib/auth/session";
import { geocodeAndCreateLocation, type MapPosition } from "@/lib/portal/createLocationStep";
import { fieldErrorsFromZod, type FieldErrors } from "@/lib/validation/fieldErrors";
import { addLocationSchema } from "@/lib/validation/restaurant";

export type AddLocationResult =
  | { ok: true; locationId: number; mapPosition: MapPosition }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

export async function addLocationAction(
  brandId: number,
  input: unknown
): Promise<AddLocationResult> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  if (session.role !== "owner" && session.role !== "admin") {
    return { ok: false, error: "Only the restaurant's owner or an admin can add a location." };
  }
  if (!Number.isInteger(brandId) || brandId <= 0) {
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  const parsed = addLocationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields and try again.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const created = await geocodeAndCreateLocation(brandId, parsed.data, session.accessToken);
  if (!created.ok) {
    return { ok: false, error: `We couldn't add this location. ${created.error}` };
  }
  return { ok: true, locationId: created.locationId, mapPosition: created.mapPosition };
}
