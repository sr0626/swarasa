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
  removeLocationPermanently,
  updateLocation,
  updateLocationHours,
  updateLocationPhoto,
  updateLocationStatus,
} from "@/lib/api/locations";
import { submitReopenRequest } from "@/lib/api/locationReopen";
import {
  createLocationDeal,
  deleteLocationDeal,
  setDealsVisibility,
  updateLocationDeal,
} from "@/lib/api/deals";
import {
  createMenuItem,
  createMenuSection,
  deleteMenuItem,
  deleteMenuSection,
  getLocationMenuForManagement,
  getMenuPhotoUploadUrl,
  removeMenuItemPhoto,
  reorderMenuItems,
  reorderMenuSections,
  setMenuItemPhoto,
  setMenuVisibility,
  updateMenuItem,
  updateMenuSection,
} from "@/lib/api/menu";
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
import {
  createReopenRequestSchema,
  updateLocationStatusSchema,
} from "@/lib/validation/locationReopen";
import { dealFormSchema, updateDealFormSchema } from "@/lib/validation/deal";
import {
  createMenuItemSchema,
  MENU_PHOTO_TYPES,
  menuSectionSchema,
  reorderIdsSchema,
  updateMenuItemSchema,
} from "@/lib/validation/menu";
import type {
  CreateMenuItemInput,
  MenuItem,
  MenuResponse,
  MenuSection,
  UpdateMenuItemInput,
  VisibilityResponse,
} from "@/types/menu";
import type { CreateDealInput, Deal, UpdateDealInput } from "@/types/deal";
import type {
  LocationDetail,
  LocationHour,
  LocationManager,
  Photo,
  PhotoUploadUrlResponse,
  UpdateLocationHoursInput,
} from "@/types/location";
import type { ReopenRequestResponse } from "@/types/locationReopen";
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
 * The client POSTs a multipart form (the returned `fields` + the file)
 * directly to `upload_url` (never through this action/Lambda, root
 * CLAUDE.md's S3 presigned-URL pattern — see
 * `frontend/src/lib/api/locations.ts`'s `getLocationPhotoUploadUrl` for
 * why it's POST, not PUT), then calls `createLocationPhotoAction` below
 * with the same `s3_key`.
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

/** POST /locations/{id}/photos — step 2, records the row after the S3 upload succeeds. */
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

/**
 * POST /locations/{id}/status — owner (or admin) self-service status
 * change. Manager-restricted here too (docs/PROJECT_PLAN.csv "Location
 * status lifecycle": "manager should NOT be able to change status,
 * owner-only") — the backend's `require_location_owner_or_admin`
 * dependency enforces the same thing server-side, this is just the same
 * "fail fast with a clear message" belt-and-suspenders pattern as
 * `assignLocationManagerAction` above.
 */
export async function updateLocationStatusAction(
  locationId: number,
  status: unknown
): Promise<ActionResult<LocationDetail>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;
  if (auth.role !== "owner" && auth.role !== "admin") {
    return { ok: false, error: "Only the owner or an admin can change a location's status." };
  }

  const parsed = updateLocationStatusSchema.safeParse({ status });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid status." };
  }

  try {
    const location = await updateLocationStatus(locationId, parsed.data, auth.accessToken);
    revalidateLocationPaths(locationId);
    return { ok: true, data: location };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return {
        ok: false,
        error:
          "This location is closed pending admin review — submit a reopen request instead of changing its status directly.",
      };
    }
    return { ok: false, error: messageFor(error, "Could not update this location's status.") };
  }
}

/**
 * POST /locations/{id}/reopen-requests — owner-only (the only path back
 * to `active` from `closed_pending_reopen`; see
 * app/services/location_reopen_service.py).
 */
export async function submitReopenRequestAction(
  locationId: number,
  notes: string
): Promise<ActionResult<ReopenRequestResponse>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;
  if (auth.role !== "owner") {
    return { ok: false, error: "Only the location's owner can request a reopen." };
  }

  const parsed = createReopenRequestSchema.safeParse({ notes: notes || undefined });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check your notes and try again." };
  }

  try {
    const request = await submitReopenRequest(locationId, parsed.data, auth.accessToken);
    revalidateLocationPaths(locationId);
    return { ok: true, data: request };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: messageFor(error, "Could not submit the reopen request.") };
  }
}

/**
 * DELETE /locations/{id}/permanent — owner (owns parent brand) or admin.
 * Real, irreversible row delete, distinct from `updateLocationStatusAction`
 * above (which only ever hides/shows the location). The backend's own
 * guardrails (docs/API_CONTRACTS.md "DELETE /locations/{id}/permanent") do
 * the real enforcement server-side; this just passes the resulting 409
 * message straight through rather than guessing at a friendlier one, since
 * the backend's messages already name the exact blocker (still active, an
 * active manager, a pending claim, a pending reopen request).
 *
 * Unlike every other action here, there is no `LocationDetail` to return
 * on success — the location is gone. Callers should navigate away (see
 * `LocationStatusMenu.tsx`) rather than re-render this page.
 */
export async function removeLocationAction(locationId: number): Promise<ActionResult<null>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;
  if (auth.role !== "owner" && auth.role !== "admin") {
    return { ok: false, error: "Only the owner or an admin can remove a location." };
  }

  try {
    await removeLocationPermanently(locationId, auth.accessToken);
    revalidatePath("/account");
    revalidatePath("/admin/listings");
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not remove this location.") };
  }
}

// ---- Deals (docs/API_CONTRACTS.md "Deals (`deal`)") -----------------------
// Free-tier feature: no `is_paid` check anywhere below (product decision,
// 2026-09-23). Owner, assigned manager and admin all pass
// `requireLocationSession`; the backend's `require_location_write_access`
// re-validates ownership/assignment on every call.

/**
 * Deal writes change what the public sees ("Deal(s) available today"
 * badge on search tiles and the detail page), so purge the search page and
 * homepage too — tiles read `has_deal_today` through a 60s-cached public GET.
 */
function revalidateDealPaths(locationId: number): void {
  revalidateLocationPaths(locationId);
  revalidatePath("/search");
  revalidatePath("/");
}

/** POST /locations/{id}/deals. */
export async function createLocationDealAction(
  locationId: number,
  input: unknown
): Promise<ActionResult<Deal>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  const parsed = dealFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check the deal and try again.",
    };
  }

  try {
    // applicable_days is validated 0..6 at runtime; zod infers `number[]`.
    const deal = await createLocationDeal(
      locationId,
      parsed.data as CreateDealInput,
      auth.accessToken
    );
    revalidateDealPaths(locationId);
    return { ok: true, data: deal };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not save this deal.") };
  }
}

/** PATCH /locations/{id}/deals/{deal_id} — full edit, or just `is_active`. */
export async function updateLocationDealAction(
  locationId: number,
  dealId: number,
  input: unknown
): Promise<ActionResult<Deal>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  const parsed = updateDealFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check the deal and try again.",
    };
  }

  try {
    const deal = await updateLocationDeal(
      locationId,
      dealId,
      parsed.data as UpdateDealInput,
      auth.accessToken
    );
    revalidateDealPaths(locationId);
    return { ok: true, data: deal };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not update this deal.") };
  }
}

/** PUT /locations/{id}/deals/visibility — "Hide all deals" / "Show all deals". */
export async function setDealsHiddenAction(
  locationId: number,
  isHidden: boolean
): Promise<ActionResult<VisibilityResponse>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  try {
    const result = await setDealsVisibility(locationId, isHidden === true, auth.accessToken);
    revalidateDealPaths(locationId);
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not change deal visibility.") };
  }
}

/** DELETE /locations/{id}/deals/{deal_id} — hard delete. */
export async function deleteLocationDealAction(
  locationId: number,
  dealId: number
): Promise<ActionResult<null>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  try {
    await deleteLocationDeal(locationId, dealId, auth.accessToken);
    revalidateDealPaths(locationId);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not delete this deal.") };
  }
}

// ---- Menu (docs/API_CONTRACTS.md "Menu (`menu_section`, `menu_item`)") ----
// Free-tier feature: no `is_paid` check anywhere below. Owner, assigned
// manager and admin all pass `requireLocationSession`; the backend's
// `require_location_write_access` re-validates ownership/assignment on every
// call. Item photos are additionally gated by the backend's platform flag
// (a 403 `menu_photos_disabled` while off) — the UI never shows the control
// then, this just passes any rejection through.

/**
 * Menu writes change what the public restaurant page shows, and that page
 * reads the (public) menu through a 60s-cached GET — purge every restaurant
 * page (the slug isn't known here) plus this location's editor.
 */
function revalidateMenuPaths(locationId: number): void {
  revalidateLocationPaths(locationId);
  revalidatePath("/restaurant/[slug]", "page");
}

/** GET /locations/{id}/menu with the caller's token — the editor re-reads the
 * whole menu after each write so it can never drift from the server. */
export async function getLocationMenuAction(
  locationId: number
): Promise<ActionResult<MenuResponse>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  try {
    const menu = await getLocationMenuForManagement(locationId, auth.accessToken);
    return { ok: true, data: menu };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not refresh the menu.") };
  }
}

/** POST /locations/{id}/menu/sections. */
export async function createMenuSectionAction(
  locationId: number,
  input: unknown
): Promise<ActionResult<MenuSection>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  const parsed = menuSectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the group and try again." };
  }
  try {
    const section = await createMenuSection(locationId, parsed.data, auth.accessToken);
    revalidateMenuPaths(locationId);
    return { ok: true, data: section };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not save this group.") };
  }
}

/** PATCH /locations/{id}/menu/sections/{section_id}. */
export async function updateMenuSectionAction(
  locationId: number,
  sectionId: number,
  input: unknown
): Promise<ActionResult<MenuSection>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  const parsed = menuSectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the group and try again." };
  }
  try {
    const section = await updateMenuSection(locationId, sectionId, parsed.data, auth.accessToken);
    revalidateMenuPaths(locationId);
    return { ok: true, data: section };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not update this group.") };
  }
}

/** PUT /locations/{id}/menu/visibility — hide/show the ENTIRE menu. */
export async function setMenuHiddenAction(
  locationId: number,
  isHidden: boolean
): Promise<ActionResult<VisibilityResponse>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  try {
    const result = await setMenuVisibility(locationId, isHidden === true, auth.accessToken);
    revalidateMenuPaths(locationId);
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not change menu visibility.") };
  }
}

/** PATCH /locations/{id}/menu/sections/{section_id} with only `is_hidden`. */
export async function setMenuSectionHiddenAction(
  locationId: number,
  sectionId: number,
  isHidden: boolean
): Promise<ActionResult<MenuSection>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  try {
    const section = await updateMenuSection(
      locationId,
      sectionId,
      { is_hidden: isHidden === true },
      auth.accessToken
    );
    revalidateMenuPaths(locationId);
    return { ok: true, data: section };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not change this group's visibility.") };
  }
}

/** PATCH /locations/{id}/menu/items/{item_id} with only `is_hidden`. */
export async function setMenuItemHiddenAction(
  locationId: number,
  itemId: number,
  isHidden: boolean
): Promise<ActionResult<MenuItem>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  try {
    const item = await updateMenuItem(
      locationId,
      itemId,
      { is_hidden: isHidden === true },
      auth.accessToken
    );
    revalidateMenuPaths(locationId);
    return { ok: true, data: item };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not change this item's visibility.") };
  }
}

/** DELETE /locations/{id}/menu/sections/{section_id}[?delete_items=true]. */
export async function deleteMenuSectionAction(
  locationId: number,
  sectionId: number,
  deleteItems: boolean
): Promise<ActionResult<null>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  try {
    await deleteMenuSection(locationId, sectionId, deleteItems, auth.accessToken);
    revalidateMenuPaths(locationId);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not delete this group.") };
  }
}

/** PUT /locations/{id}/menu/sections/order. */
export async function reorderMenuSectionsAction(
  locationId: number,
  ids: unknown
): Promise<ActionResult<MenuResponse>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  const parsed = reorderIdsSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Could not reorder the groups." };
  try {
    const menu = await reorderMenuSections(locationId, parsed.data, auth.accessToken);
    revalidateMenuPaths(locationId);
    return { ok: true, data: menu };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not reorder the groups.") };
  }
}

/** POST /locations/{id}/menu/items. */
export async function createMenuItemAction(
  locationId: number,
  input: unknown
): Promise<ActionResult<MenuItem>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  const parsed = createMenuItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the item and try again." };
  }
  try {
    const item = await createMenuItem(locationId, parsed.data as CreateMenuItemInput, auth.accessToken);
    revalidateMenuPaths(locationId);
    return { ok: true, data: item };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not save this item.") };
  }
}

/** PATCH /locations/{id}/menu/items/{item_id} — full edit or a partial move. */
export async function updateMenuItemAction(
  locationId: number,
  itemId: number,
  input: unknown
): Promise<ActionResult<MenuItem>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  const parsed = updateMenuItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the item and try again." };
  }
  try {
    const item = await updateMenuItem(locationId, itemId, parsed.data as UpdateMenuItemInput, auth.accessToken);
    revalidateMenuPaths(locationId);
    return { ok: true, data: item };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not update this item.") };
  }
}

/** DELETE /locations/{id}/menu/items/{item_id}. */
export async function deleteMenuItemAction(
  locationId: number,
  itemId: number
): Promise<ActionResult<null>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  try {
    await deleteMenuItem(locationId, itemId, auth.accessToken);
    revalidateMenuPaths(locationId);
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not delete this item.") };
  }
}

/** PUT /locations/{id}/menu/items/order — one group's full id list. */
export async function reorderMenuItemsAction(
  locationId: number,
  sectionId: number | null,
  ids: unknown
): Promise<ActionResult<MenuResponse>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  const parsed = reorderIdsSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Could not reorder the items." };
  try {
    const menu = await reorderMenuItems(locationId, sectionId, parsed.data, auth.accessToken);
    revalidateMenuPaths(locationId);
    return { ok: true, data: menu };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not reorder the items.") };
  }
}

/** POST /locations/{id}/menu/photo-upload-url — only reachable while the photo flag is on. */
export async function getMenuPhotoUploadUrlAction(
  locationId: number,
  contentType: string
): Promise<ActionResult<PhotoUploadUrlResponse>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  if (!(MENU_PHOTO_TYPES as readonly string[]).includes(contentType)) {
    return { ok: false, error: "Only JPEG or PNG images are supported." };
  }
  try {
    const result = await getMenuPhotoUploadUrl(locationId, contentType, auth.accessToken);
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not start the photo upload.") };
  }
}

/** PUT /locations/{id}/menu/items/{item_id}/photo — attach/replace after the S3 upload. */
export async function setMenuItemPhotoAction(
  locationId: number,
  itemId: number,
  s3Key: string
): Promise<ActionResult<MenuItem>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  if (!s3Key) return { ok: false, error: "Invalid photo upload." };
  try {
    const item = await setMenuItemPhoto(locationId, itemId, s3Key, auth.accessToken);
    revalidateMenuPaths(locationId);
    return { ok: true, data: item };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not save the uploaded photo.") };
  }
}

/** DELETE /locations/{id}/menu/items/{item_id}/photo. */
export async function removeMenuItemPhotoAction(
  locationId: number,
  itemId: number
): Promise<ActionResult<MenuItem>> {
  const auth = await requireLocationSession();
  if (!auth.ok) return auth;

  try {
    const item = await removeMenuItemPhoto(locationId, itemId, auth.accessToken);
    revalidateMenuPaths(locationId);
    return { ok: true, data: item };
  } catch (error) {
    return { ok: false, error: messageFor(error, "Could not remove this photo.") };
  }
}
