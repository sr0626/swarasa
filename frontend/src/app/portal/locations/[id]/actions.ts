"use server";

// Server Actions backing the location editor's client components (info
// form, hours editor, photo manager, manager assignment) — same
// "keep the Cognito access token server-side" rationale as
// frontend/src/app/claim/actions.ts and
// frontend/src/app/admin/claims/actions.ts. Every action independently
// re-derives the session from the httpOnly cookie (never trusts a role/id
// passed in from the client) since a Server Action is a real network
// endpoint Next.js exposes, callable on its own. The underlying typed
// /lib/api/locations.ts calls still hit the real backend, which
// re-validates ownership/assignment server-side on every write (root
// CLAUDE.md "Permission model") — these actions are a thin, safe bridge,
// not a second source of truth for authorization.
import { revalidatePath } from "next/cache";
import { ApiError } from "@/lib/api/client";
import {
  assignLocationManager,
  createLocationPhoto,
  deleteLocationPhoto,
  getLocationPhotoUploadUrl,
  removeLocationManager,
  updateLocation,
  updateLocationHours,
  updateLocationPhoto,
} from "@/lib/api/locations";
import { getServerSession } from "@/lib/auth/session";
import { geocodeAddress } from "@/lib/geocode";
import {
  assignLocationManagerSchema,
  createPhotoSchema,
  photoUploadUrlSchema,
  updateLocationAboutSchema,
  updateLocationHoursSchema,
  updateLocationSchema,
} from "@/lib/validation/location";
import type {
  LocationDetail,
  LocationHour,
  LocationManager,
  Photo,
  PhotoUploadUrlResponse,
  UpdateLocationHoursInput,
} from "@/types/location";
import type { UserRole } from "@/types/auth";

type ActionResult<T> = { ok: true; data: T; notice?: string } | { ok: false; error: string };

async function requireLocationSession(): Promise<
  { ok: true; accessToken: string; role: UserRole } | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  // Admin is allowed too: the backend's location write routes have an admin
  // branch (docs/PROJECT_PLAN.csv "Platform admin full-access parity"), and
  // the editor page now opens for admins (Edit link on the public listing).
  // Manager assignment stays owner-only below -- that contract has no admin path.
  if (session.role !== "owner" && session.role !== "manager" && session.role !== "admin") {
    return { ok: false, error: "You don't have access to this location." };
  }
  return { ok: true, accessToken: session.accessToken, role: session.role };
}

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  return fallback;
}

/**
 * Purges the Next.js Data Cache for every page that shows this location's
 * data, after a successful info/about/hours save.
 *
 * Root cause (confirmed 2026-09-22): the owner console's restaurant tiles
 * (`/account`) and this location's own editor page (`/portal/locations/
 * {id}`) both read this location through PUBLIC GET endpoints
 * (`GET /restaurants/{id}/locations` via
 * `lib/owner/loadOwnerRestaurants.ts`, and `GET /locations/{id}` on
 * `app/portal/locations/[id]/page.tsx` itself) — neither call attaches an
 * access token, so `lib/api/client.ts`'s `apiFetch` never applies
 * `cache: "no-store"` (that only kicks in `options.accessToken ?
 * { cache: "no-store" } : {}`). Both instead use `next: { revalidate: 60 }`,
 * so a save lands in the DB immediately but the next render within that
 * 60s window still serves the stale Data Cache entry — that's the "doesn't
 * show until a hard refresh" bug. PR #141's authenticated
 * `cache: "no-store"` fix doesn't reach this path because these reads are
 * public, unauthenticated GETs by design (the editor page's own access
 * check happens via the separate `GET /locations/{id}/managers` call, not
 * this one).
 *
 * `revalidatePath` purges the Next Data Cache for fetches made while
 * rendering the given path, so the very next visit re-fetches fresh data
 * regardless of the 60s window.
 */
function revalidateLocationPaths(locationId: number): void {
  revalidatePath("/account");
  revalidatePath(`/portal/locations/${locationId}`);
}

/**
 * PATCH /locations/{id} — info/address/contact fields.
 *
 * `options.regeocode`: the client sets this when the street/city/state/ZIP
 * changed and the owner did NOT type new coordinates by hand — the old
 * lat/lng would otherwise silently go stale. The address is then geocoded
 * here (server-side: the API Lambda has no internet, see
 * lib/geocode). On a miss the coordinates are left unchanged
 * and a `notice` tells the owner; the save itself never fails on geocoding.
 */
export async function updateLocationInfoAction(
  locationId: number,
  input: unknown,
  options?: { regeocode?: boolean }
): Promise<ActionResult<LocationDetail>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  const parsed = updateLocationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check the form and try again.",
    };
  }

  const update = { ...parsed.data };
  let notice: string | undefined;
  if (
    options?.regeocode &&
    update.address_line1 &&
    update.city &&
    update.state &&
    update.postal_code
  ) {
    const coordinates = await geocodeAddress({
      address_line1: update.address_line1,
      city: update.city,
      state: update.state,
      postal_code: update.postal_code,
    });
    if (coordinates) {
      update.latitude = coordinates.latitude;
      update.longitude = coordinates.longitude;
      if (coordinates.precision === "postal_code") {
        notice = "Saved. The map position is approximate (matched by ZIP code only).";
      }
    } else {
      // Keep whatever is stored; never fabricate. A missing position keeps
      // the listing out of nearby searches, so say so.
      delete update.latitude;
      delete update.longitude;
      notice =
        "Saved, but we couldn't find the new address on the map, so the map position wasn't updated. Check the street address, or contact us and we'll set it for you.";
    }
  }

  try {
    const location = await updateLocation(locationId, update, auth.accessToken);
    revalidateLocationPaths(locationId);
    return { ok: true, data: location, notice };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Something went wrong saving these details.") };
  }
}

/**
 * PATCH /locations/{id} — the "About & specialties" public-profile fields
 * only. Sending null (or an empty list/string, which the backend
 * normalises to null) clears the stored value.
 */
export async function updateLocationAboutAction(
  locationId: number,
  input: unknown
): Promise<ActionResult<LocationDetail>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  const parsed = updateLocationAboutSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check the form and try again.",
    };
  }

  try {
    const location = await updateLocation(locationId, parsed.data, auth.accessToken);
    revalidateLocationPaths(locationId);
    return { ok: true, data: location };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Something went wrong saving this section.") };
  }
}

/** PUT /locations/{id}/hours — full week replacement. */
export async function updateLocationHoursAction(
  locationId: number,
  input: unknown
): Promise<ActionResult<LocationHour[]>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  const parsed = updateLocationHoursSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check the hours and try again.",
    };
  }

  try {
    // zod's z.number().min(0).max(6) infers as `number`, not the narrower
    // `DayOfWeek` union — the runtime range check already guarantees 0..6,
    // this cast just tells TS what the schema already enforces.
    const result = await updateLocationHours(
      locationId,
      parsed.data as UpdateLocationHoursInput,
      auth.accessToken
    );
    revalidateLocationPaths(locationId);
    return { ok: true, data: result.hours };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Something went wrong saving hours.") };
  }
}

/**
 * POST /locations/{id}/photos/upload-url — step 1 of the presigned upload.
 * The client PUTs the file directly to the returned `upload_url` (never
 * through this action/Lambda, root CLAUDE.md's S3 presigned-URL pattern),
 * then calls `createLocationPhotoAction` below with the same `s3_key`.
 */
export async function getLocationPhotoUploadUrlAction(
  locationId: number,
  contentType: string
): Promise<ActionResult<PhotoUploadUrlResponse>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  const parsed = photoUploadUrlSchema.safeParse({ content_type: contentType });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Unsupported image type.",
    };
  }

  try {
    const result = await getLocationPhotoUploadUrl(locationId, parsed.data, auth.accessToken);
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not start the photo upload.") };
  }
}

/** POST /locations/{id}/photos — step 2, records the row after the S3 PUT succeeds. */
export async function createLocationPhotoAction(
  locationId: number,
  s3Key: string,
  isCover: boolean
): Promise<ActionResult<Photo>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  const parsed = createPhotoSchema.safeParse({ s3_key: s3Key, is_cover: isCover });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid photo upload." };
  }

  try {
    const photo = await createLocationPhoto(locationId, parsed.data, auth.accessToken);
    return { ok: true, data: photo };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return {
        ok: false,
        error: "Gallery photo limit reached for this location's tier.",
      };
    }
    return { ok: false, error: messageFor(error, "Could not save the uploaded photo.") };
  }
}

/** PATCH /locations/{id}/photos/{photo_id} — promote an existing gallery photo to cover. */
export async function setLocationPhotoCoverAction(
  locationId: number,
  photoId: number
): Promise<ActionResult<Photo>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  try {
    const photo = await updateLocationPhoto(
      locationId,
      photoId,
      { is_cover: true },
      auth.accessToken
    );
    return { ok: true, data: photo };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not set this photo as the cover.") };
  }
}

/** DELETE /locations/{id}/photos/{photo_id}. */
export async function deleteLocationPhotoAction(
  locationId: number,
  photoId: number
): Promise<ActionResult<null>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  try {
    await deleteLocationPhoto(locationId, photoId, auth.accessToken);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not delete this photo.") };
  }
}

/**
 * POST /locations/{id}/managers — auth: owner only (docs/API_CONTRACTS.md
 * "no admin, no manager path"). Re-checked here even though the backend
 * enforces it too, per the task's "owner-only, not manager-editable"
 * requirement for this whole section.
 */
export async function assignLocationManagerAction(
  locationId: number,
  managerEmail: string
): Promise<ActionResult<LocationManager>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;
  if (auth.role !== "owner") {
    return { ok: false, error: "Only the location's owner can assign managers." };
  }

  const parsed = assignLocationManagerSchema.safeParse({ manager_email: managerEmail });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid email address.",
    };
  }

  try {
    const manager = await assignLocationManager(locationId, parsed.data, auth.accessToken);
    return { ok: true, data: manager };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) {
        return {
          ok: false,
          error: "No registered user exists with that email — they need to sign up first.",
        };
      }
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "Could not assign this manager. Please try again." };
  }
}

/**
 * DELETE /locations/{id}/managers/{manager_id} — auth: owner or admin per
 * the contract, but restricted to owner here too since this whole section
 * is owner-only in the portal UI (no manager-editable path).
 */
export async function removeLocationManagerAction(
  locationId: number,
  managerId: number
): Promise<ActionResult<null>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;
  if (auth.role !== "owner") {
    return { ok: false, error: "Only the location's owner can remove managers." };
  }

  try {
    await removeLocationManager(locationId, managerId, auth.accessToken);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not remove this manager.") };
  }
}
