// Client-side validation mirroring POST/PATCH /locations, PUT
// /locations/{id}/hours, and the photo sub-resource body shapes
// (docs/API_CONTRACTS.md "Locations").
import { z } from "zod";
import { normalizePhone } from "@/lib/phone";

const TIME_PATTERN = /^\d{2}:\d{2}:\d{2}$/;

/**
 * Optional phone: blank -> null, otherwise normalised to E.164
 * (`lib/phone.ts` — "(972) 555-0142" -> "+19725550142").
 */
export const optionalPhoneSchema = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx): string | null => {
    if (!value) return null;
    const normalised = normalizePhone(value);
    if (!normalised) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid phone number, e.g. (972) 555-0142",
      });
      return z.NEVER;
    }
    return normalised;
  });

/**
 * Address fields shared by POST /locations, PATCH /locations/{id} and the
 * "Add restaurant" form. `state` is upper-cased; lat/lng are optional
 * because a listing may exist before it has been geocoded.
 */
export const locationAddressShape = {
  address_line1: z.string().trim().min(1, "Street address is required").max(200),
  address_line2: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((value) => value || null),
  city: z.string().trim().min(1, "City is required").max(100),
  state: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Use a 2-letter state code, e.g. TX")
    .transform((value) => value.toUpperCase()),
  postal_code: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Enter a valid US ZIP code"),
};

export const createLocationSchema = z.object({
  brand_id: z.number().int().positive(),
  ...locationAddressShape,
  country: z.string().trim().length(2, "Use a 2-letter country code"),
  phone: optionalPhoneSchema,
  timezone: z.string().trim().min(1, "Timezone is required"),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
});

export type CreateLocationFormValues = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = createLocationSchema.omit({ brand_id: true }).partial();

export type UpdateLocationFormValues = z.infer<typeof updateLocationSchema>;

// Mirrors backend/app/schemas/location.py LocationUpdate.about/specialties
// limits (docs/API_CONTRACTS.md "PATCH /locations/{id}").
export const ABOUT_MAX_LENGTH = 1000;
export const SPECIALTIES_MAX_ITEMS = 8;
export const SPECIALTY_MAX_LENGTH = 40;

export const updateLocationAboutSchema = z.object({
  about: z
    .string()
    .trim()
    .max(ABOUT_MAX_LENGTH, `About text must be at most ${ABOUT_MAX_LENGTH} characters`)
    .nullable(),
  specialties: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(SPECIALTY_MAX_LENGTH, `Each specialty must be at most ${SPECIALTY_MAX_LENGTH} characters`)
    )
    .max(SPECIALTIES_MAX_ITEMS, `Add at most ${SPECIALTIES_MAX_ITEMS} specialties`)
    .nullable(),
});

export type UpdateLocationAboutFormValues = z.infer<typeof updateLocationAboutSchema>;

const dayHourSchema = z
  .object({
    day_of_week: z.number().int().min(0).max(6),
    open_time: z.string().regex(TIME_PATTERN, "Use HH:MM:SS").optional(),
    close_time: z.string().regex(TIME_PATTERN, "Use HH:MM:SS").optional(),
    is_closed: z.boolean().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.is_closed === false && (!value.open_time || !value.close_time)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Open and close time are required for a day that isn't closed.",
      });
    }
  });

export const updateLocationHoursSchema = z.object({
  hours: z.array(dayHourSchema).max(7),
});

export type UpdateLocationHoursFormValues = z.infer<typeof updateLocationHoursSchema>;

export const photoUploadUrlSchema = z.object({
  content_type: z.enum(["image/jpeg", "image/png", "image/webp"], {
    errorMap: () => ({ message: "Only JPEG, PNG, or WebP images are supported" }),
  }),
});

export const createPhotoSchema = z.object({
  s3_key: z.string().min(1),
  is_cover: z.boolean(),
});

export const updatePhotoSchema = z
  .object({
    display_order: z.number().int().min(0).optional(),
    is_cover: z.boolean().optional(),
  })
  .refine((value) => value.display_order !== undefined || value.is_cover !== undefined, {
    message: "Provide at least one field to update",
  });

/** Body for POST /locations/{id}/managers. */
export const assignLocationManagerSchema = z.object({
  manager_email: z.string().trim().email("Enter a valid email address"),
});

export type AssignLocationManagerFormValues = z.infer<typeof assignLocationManagerSchema>;
