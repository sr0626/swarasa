// Client-side validation mirroring the menu endpoints
// (docs/API_CONTRACTS.md "Menu (`menu_section`, `menu_item`)",
// backend/app/schemas/menu.py). The server re-validates everything — this is
// a convenience so owners get inline messages, never the guarantee.
//
// Free text throughout: names, descriptions, prices and size labels are
// trimmed but never parsed ("$12", "12 / 18", "Market price" are all valid).
import { z } from "zod";

export const MENU_LIMITS = {
  sectionName: 100,
  sectionDescription: 500,
  itemName: 150,
  itemDescription: 1000,
  price: 50,
  sizeLabel: 40,
  maxSizes: 6,
} as const;

/** Accepted menu-photo types / size — mirrors the backend upload-url route
 * (JPEG/PNG only, 2MB). */
export const MENU_PHOTO_TYPES = ["image/jpeg", "image/png"] as const;
export const MENU_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export const NAME_REQUIRED_MESSAGE = "Name is required";
export const PRICE_REQUIRED_MESSAGE = "Price is required";
export const SIZE_LABEL_REQUIRED_MESSAGE = "Size name is required";
export const SIZE_PRICE_REQUIRED_MESSAGE = "Price is required";
export const SIZES_REQUIRED_MESSAGE = "Add at least one size with a price";

/** Optional free text: trimmed, empty -> null (a cleared box clears the field). */
function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .nullish()
    .transform((value) => value || null);
}

const sizeSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, SIZE_LABEL_REQUIRED_MESSAGE)
    .max(MENU_LIMITS.sizeLabel, `Size name must be at most ${MENU_LIMITS.sizeLabel} characters`),
  price: z
    .string()
    .trim()
    .min(1, SIZE_PRICE_REQUIRED_MESSAGE)
    .max(MENU_LIMITS.price, `Price must be at most ${MENU_LIMITS.price} characters`),
});

const priceSchema = z
  .string()
  .trim()
  .min(1, PRICE_REQUIRED_MESSAGE)
  .max(MENU_LIMITS.price, `Price must be at most ${MENU_LIMITS.price} characters`);

const sizesSchema = z
  .array(sizeSchema)
  .min(1, SIZES_REQUIRED_MESSAGE)
  .max(MENU_LIMITS.maxSizes, `An item can have at most ${MENU_LIMITS.maxSizes} sizes`);

const itemShape = z.object({
  name: z
    .string()
    .trim()
    .min(1, NAME_REQUIRED_MESSAGE)
    .max(MENU_LIMITS.itemName, `Name must be at most ${MENU_LIMITS.itemName} characters`),
  description: optionalText(MENU_LIMITS.itemDescription, "Description"),
  price: priceSchema.nullish().transform((value) => value ?? null),
  sizes: sizesSchema.nullish().transform((value) => value ?? null),
  section_id: z.number().int().positive().nullish().transform((value) => value ?? null),
});

type PriceForms = { price?: string | null; sizes?: unknown[] | null };

/** CREATE / full form save: exactly one of `price` / `sizes`. */
function checkExactlyOnePriceForm(value: PriceForms, ctx: z.RefinementCtx) {
  const hasPrice = value.price != null;
  const hasSizes = value.sizes != null;
  if (hasPrice && hasSizes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Use either one price or sizes, not both",
      path: ["price"],
    });
  } else if (!hasPrice && !hasSizes) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: PRICE_REQUIRED_MESSAGE, path: ["price"] });
  }
}

export const createMenuItemSchema = itemShape.superRefine(checkExactlyOnePriceForm);

/** PATCH: every field optional; only the both-at-once case is rejected (the
 * server clears the other form when one is sent). */
export const updateMenuItemSchema = itemShape
  .partial()
  .superRefine((value, ctx) => {
    if (value.price != null && value.sizes != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use either one price or sizes, not both",
        path: ["price"],
      });
    }
  });

export const menuSectionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, NAME_REQUIRED_MESSAGE)
    .max(MENU_LIMITS.sectionName, `Name must be at most ${MENU_LIMITS.sectionName} characters`),
  description: optionalText(MENU_LIMITS.sectionDescription, "Description"),
});

export const reorderIdsSchema = z.array(z.number().int().positive());

// ---------------------------------------------------------------------------
// Form-level helper used by the editor: turns the raw form state into the API
// input, or per-field / per-size-row messages.
// ---------------------------------------------------------------------------

export type PriceMode = "single" | "sizes";

export interface MenuItemFormState {
  name: string;
  description: string;
  priceMode: PriceMode;
  price: string;
  sizes: { label: string; price: string }[];
  /** null = ungrouped. */
  section_id: number | null;
}

export interface MenuItemFormErrors {
  name?: string;
  description?: string;
  /** Single-price mode. */
  price?: string;
  /** Sizes mode, list-level ("Add at least one size"). */
  sizes?: string;
  /** Sizes mode, one entry per row (same index as the form's `sizes`). */
  sizeRows: { label?: string; price?: string }[];
}

export type MenuItemFormResult =
  | { ok: true; value: z.infer<typeof createMenuItemSchema> }
  | { ok: false; errors: MenuItemFormErrors };

/**
 * Validate the item form. The mode decides which pricing field is sent (the
 * other is dropped, so switching modes never posts both); inline errors are
 * keyed the way the editor renders them.
 */
export function validateMenuItemForm(form: MenuItemFormState): MenuItemFormResult {
  const candidate = {
    name: form.name,
    description: form.description,
    price: form.priceMode === "single" ? form.price : null,
    sizes: form.priceMode === "sizes" ? form.sizes : null,
    section_id: form.section_id,
  };
  const parsed = createMenuItemSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, value: parsed.data };

  const errors: MenuItemFormErrors = { sizeRows: form.sizes.map(() => ({})) };
  for (const issue of parsed.error.issues) {
    const [field, index, sub] = issue.path;
    if (field === "name" && !errors.name) errors.name = issue.message;
    else if (field === "description" && !errors.description) errors.description = issue.message;
    else if (field === "price" && !errors.price) errors.price = issue.message;
    else if (field === "sizes" && typeof index === "number" && (sub === "label" || sub === "price")) {
      const row = errors.sizeRows[index];
      if (row && !row[sub]) row[sub] = issue.message;
    } else if (field === "sizes" && !errors.sizes) errors.sizes = issue.message;
  }
  return { ok: false, errors };
}
