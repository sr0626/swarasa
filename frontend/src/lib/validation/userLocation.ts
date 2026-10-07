// Diner home location (city + ZIP) — mirrors backend/app/schemas/auth.py
// (`MeUpdateRequest` city/postal_code validators): city 2-100 chars after
// trimming, postal code a US 5-digit ZIP or ZIP+4. Used by the signup form
// (diner type), the account-page location form and the server action that
// backs both. Mandatory for registered users (user decision 2026-10-07).
import { z } from "zod";

export const CITY_MIN_LENGTH = 2;
export const CITY_MAX_LENGTH = 100;
export const POSTAL_CODE_ERROR = "Enter a valid US ZIP code (12345 or 12345-6789)";
export const LOCATION_HELPER_TEXT =
  "We use your city and ZIP to find restaurants and deals near you.";

const US_ZIP = /^\d{5}(-\d{4})?$/;

export const citySchema = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(1, "City is required")
      .min(CITY_MIN_LENGTH, `City must be at least ${CITY_MIN_LENGTH} characters`)
      .max(CITY_MAX_LENGTH, `City must be at most ${CITY_MAX_LENGTH} characters`)
  );

export const postalCodeSchema = z
  .string()
  .trim()
  .min(1, "ZIP code is required")
  .regex(US_ZIP, POSTAL_CODE_ERROR);

export const userLocationSchema = z.object({
  city: citySchema,
  postal_code: postalCodeSchema,
});

export type UserLocationValues = z.infer<typeof userLocationSchema>;

/** True once both halves of a diner's home location are saved. */
export function hasLocation(
  me: { city?: string | null; postal_code?: string | null } | null | undefined
): boolean {
  return Boolean(me?.city?.trim()) && Boolean(me?.postal_code?.trim());
}
