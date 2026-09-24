// Types for the menu (`menu_section` + `menu_item`) — docs/API_CONTRACTS.md
// "Menu (`menu_section`, `menu_item`)", matching backend/app/schemas/menu.py.
//
// Free-tier feature: the menu (prices included) is public and never gated on
// `is_paid`. The optional item photo is built but switched OFF by the
// `menu_item_photos_enabled` platform flag; the client learns the flag from
// `MenuResponse.menu_photos_enabled` and every photo URL is null while it is
// off.

/** One size option of a sized item — both free text, both required. Array
 * order is the display order. */
export interface MenuSize {
  label: string;
  price: string;
}

/** An item has EITHER a single free-text `price` OR `sizes` (never both,
 * never neither). */
export interface MenuItem {
  id: number;
  location_id: number;
  /** null = ungrouped (renders first, under no heading). */
  section_id: number | null;
  name: string;
  description: string | null;
  price: string | null;
  sizes: MenuSize[] | null;
  display_order: number;
  /** Always null while the photo flag is off, and for an item with no photo. */
  photo_url: string | null;
  photo_thumbnail_url: string | null;
}

/** Response of the section create/update endpoints (no items). */
export interface MenuSection {
  id: number;
  location_id: number;
  name: string;
  description: string | null;
  display_order: number;
}

export interface MenuSectionWithItems {
  id: number;
  name: string;
  description: string | null;
  display_order: number;
  items: MenuItem[];
}

/** GET /locations/{id}/menu — the whole structured menu. */
export interface MenuResponse {
  location_id: number;
  menu_photos_enabled: boolean;
  /** Items with no group — render first, under no heading. */
  ungrouped_items: MenuItem[];
  sections: MenuSectionWithItems[];
}

/** Body for POST /locations/{id}/menu/sections. */
export interface CreateMenuSectionInput {
  name: string;
  description: string | null;
}

/** Body for PATCH /locations/{id}/menu/sections/{id}. */
export type UpdateMenuSectionInput = Partial<CreateMenuSectionInput>;

/** Body for POST /locations/{id}/menu/items — exactly one of `price` /
 * `sizes` must be set. */
export interface CreateMenuItemInput {
  name: string;
  description: string | null;
  price: string | null;
  sizes: MenuSize[] | null;
  section_id: number | null;
}

/** Body for PATCH /locations/{id}/menu/items/{id}. Send only the new pricing
 * form's field (`price` or `sizes`) — the server clears the other. */
export type UpdateMenuItemInput = Partial<CreateMenuItemInput>;
