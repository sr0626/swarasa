// Typed client for the menu sub-resource of `/locations/{id}` —
// docs/API_CONTRACTS.md "Menu (`menu_section`, `menu_item`)". The GET is
// PUBLIC (free-tier, never gated on `is_paid`); every write is owner/
// assigned-manager/admin (checked server-side on each call).
import { apiFetch } from "./client";
import type {
  CreateMenuItemInput,
  CreateMenuSectionInput,
  MenuItem,
  MenuResponse,
  MenuSection,
  UpdateMenuItemInput,
  UpdateMenuSectionInput,
} from "@/types/menu";
import type { PhotoUploadUrlResponse } from "@/types/location";

/**
 * GET /locations/{id}/menu — public. Like `getLocationById`, pass
 * `accessToken` when the caller is signed in and may need to see their OWN
 * non-active location's menu (the editor, an owner previewing); omit it for
 * a genuinely public/SSR read (cached 60s).
 */
export async function getLocationMenu(
  locationId: number,
  accessToken?: string
): Promise<MenuResponse> {
  return apiFetch<MenuResponse>(
    `/locations/${locationId}/menu`,
    { method: "GET" },
    { accessToken, revalidateSeconds: accessToken ? undefined : 60 }
  );
}

/** POST /locations/{id}/menu/sections. */
export async function createMenuSection(
  locationId: number,
  input: CreateMenuSectionInput,
  accessToken: string
): Promise<MenuSection> {
  return apiFetch<MenuSection>(
    `/locations/${locationId}/menu/sections`,
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/** PATCH /locations/{id}/menu/sections/{section_id}. */
export async function updateMenuSection(
  locationId: number,
  sectionId: number,
  input: UpdateMenuSectionInput,
  accessToken: string
): Promise<MenuSection> {
  return apiFetch<MenuSection>(
    `/locations/${locationId}/menu/sections/${sectionId}`,
    { method: "PATCH", body: JSON.stringify(input) },
    { accessToken }
  );
}

/**
 * DELETE /locations/{id}/menu/sections/{section_id}. By default the group's
 * items are KEPT and moved to ungrouped; `deleteItems: true` deletes them
 * with the group.
 */
export async function deleteMenuSection(
  locationId: number,
  sectionId: number,
  deleteItems: boolean,
  accessToken: string
): Promise<void> {
  const query = deleteItems ? "?delete_items=true" : "";
  return apiFetch<void>(
    `/locations/${locationId}/menu/sections/${sectionId}${query}`,
    { method: "DELETE" },
    { accessToken }
  );
}

/** PUT /locations/{id}/menu/sections/order — the FULL id list, new order. */
export async function reorderMenuSections(
  locationId: number,
  ids: number[],
  accessToken: string
): Promise<MenuResponse> {
  return apiFetch<MenuResponse>(
    `/locations/${locationId}/menu/sections/order`,
    { method: "PUT", body: JSON.stringify({ ids }) },
    { accessToken }
  );
}

/** POST /locations/{id}/menu/items. */
export async function createMenuItem(
  locationId: number,
  input: CreateMenuItemInput,
  accessToken: string
): Promise<MenuItem> {
  return apiFetch<MenuItem>(
    `/locations/${locationId}/menu/items`,
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/** PATCH /locations/{id}/menu/items/{item_id}. */
export async function updateMenuItem(
  locationId: number,
  itemId: number,
  input: UpdateMenuItemInput,
  accessToken: string
): Promise<MenuItem> {
  return apiFetch<MenuItem>(
    `/locations/${locationId}/menu/items/${itemId}`,
    { method: "PATCH", body: JSON.stringify(input) },
    { accessToken }
  );
}

/** DELETE /locations/{id}/menu/items/{item_id}. */
export async function deleteMenuItem(
  locationId: number,
  itemId: number,
  accessToken: string
): Promise<void> {
  return apiFetch<void>(
    `/locations/${locationId}/menu/items/${itemId}`,
    { method: "DELETE" },
    { accessToken }
  );
}

/** PUT /locations/{id}/menu/items/order — the FULL id list of one group
 * (`sectionId` null = the ungrouped list), new order. */
export async function reorderMenuItems(
  locationId: number,
  sectionId: number | null,
  ids: number[],
  accessToken: string
): Promise<MenuResponse> {
  return apiFetch<MenuResponse>(
    `/locations/${locationId}/menu/items/order`,
    { method: "PUT", body: JSON.stringify({ section_id: sectionId, ids }) },
    { accessToken }
  );
}

/** POST /locations/{id}/menu/photo-upload-url — presigned S3 POST for a menu
 * photo (JPEG/PNG, 2MB). 403 `menu_photos_disabled` while the platform flag
 * is off. */
export async function getMenuPhotoUploadUrl(
  locationId: number,
  contentType: string,
  accessToken: string
): Promise<PhotoUploadUrlResponse> {
  return apiFetch<PhotoUploadUrlResponse>(
    `/locations/${locationId}/menu/photo-upload-url`,
    { method: "POST", body: JSON.stringify({ content_type: contentType }) },
    { accessToken }
  );
}

/** PUT /locations/{id}/menu/items/{item_id}/photo — attach or replace. */
export async function setMenuItemPhoto(
  locationId: number,
  itemId: number,
  s3Key: string,
  accessToken: string
): Promise<MenuItem> {
  return apiFetch<MenuItem>(
    `/locations/${locationId}/menu/items/${itemId}/photo`,
    { method: "PUT", body: JSON.stringify({ s3_key: s3Key }) },
    { accessToken }
  );
}

/** DELETE /locations/{id}/menu/items/{item_id}/photo. */
export async function removeMenuItemPhoto(
  locationId: number,
  itemId: number,
  accessToken: string
): Promise<MenuItem> {
  return apiFetch<MenuItem>(
    `/locations/${locationId}/menu/items/${itemId}/photo`,
    { method: "DELETE" },
    { accessToken }
  );
}
