// Client-side validation mirroring POST/PATCH /restaurants body shapes
// (docs/API_CONTRACTS.md "Restaurants") and the combined "Add restaurant"
// form (brand + first location).
import { z } from "zod";
import { locationAddressShape, requiredPhoneSchema } from "./location";

/**
 * Optional website: blank -> null; a bare "example.com" gets "https://"
 * prepended; anything that isn't a plausible http(s) URL is rejected.
 * Max 500 chars (RestaurantCreate.website).
 */
export const optionalWebsiteSchema = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx): string | null => {
    if (!value) return null;
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    let valid = withScheme.length <= 500 && !/\s/.test(withScheme);
    if (valid) {
      try {
        const url = new URL(withScheme);
        valid =
          (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".");
      } catch {
        valid = false;
      }
    }
    if (!valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid website address, e.g. https://example.com",
      });
      return z.NEVER;
    }
    return withScheme;
  });

// `cuisine_tag_ids` is a FORM field of the combined Add-restaurant flow only: the tags
// belong to the first LOCATION (POST /locations), not the brand (POST /restaurants).
export const createRestaurantSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().trim().min(1, "Description is required").max(2000),
  website: optionalWebsiteSchema,
  cuisine_tag_ids: z.array(z.number().int().positive()).min(1, "Pick at least one cuisine tag"),
});

export type CreateRestaurantFormValues = z.infer<typeof createRestaurantSchema>;

export const updateRestaurantSchema = createRestaurantSchema.partial();

export type UpdateRestaurantFormValues = z.infer<typeof updateRestaurantSchema>;

/**
 * "Add restaurant" form: the brand fields plus the first location's
 * address and phone (flat — the server action splits them into the
 * POST /restaurants and POST /locations bodies). Coordinates and timezone
 * are server-derived, never form input.
 */
export const addRestaurantSchema = createRestaurantSchema.extend({
  ...locationAddressShape,
  // Required 2026-09-22 (docs/PROJECT_PLAN.csv "Make location phone
  // required") -- same standing as `name` above.
  phone: requiredPhoneSchema,
});

/**
 * "Add location" form (another branch of an EXISTING restaurant): just the
 * address and phone — the brand fields are already on the restaurant. The
 * brand id travels separately (URL/param), never as form input.
 */
export const addLocationSchema = z.object({
  ...locationAddressShape,
  phone: requiredPhoneSchema,
  // Tags for the new branch (pre-filled with the first location's; empty allowed).
  // Omitted -> the backend copies the brand's first location's tags itself.
  cuisine_tag_ids: z.array(z.number().int().positive()).optional(),
});

export type AddLocationFormInput = z.input<typeof addLocationSchema>;
export type AddLocationValues = z.output<typeof addLocationSchema>;

/** Raw (pre-transform) input shape the form holds; the parsed output has normalised phone/website/state. */
export type AddRestaurantFormInput = z.input<typeof addRestaurantSchema>;
export type AddRestaurantValues = z.output<typeof addRestaurantSchema>;
