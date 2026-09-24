// zod wrappers around the ONE shared US phone rule (lib/phone.ts, mirrored by
// backend/app/core/phone.py). Every phone field on the site — location
// create/update, Add restaurant, Add location, the owner profile, admin forms
// — uses these, so the rule and the inline message can't drift.
import { z } from "zod";
import { US_PHONE_ERROR, normalizePhone } from "@/lib/phone";

/**
 * Required phone: rejects blank ("Phone number is required"), otherwise
 * normalised to `+1XXXXXXXXXX`; anything that isn't a valid 10-digit US
 * number fails with `US_PHONE_ERROR`.
 */
export const requiredPhoneSchema = z
  .string()
  .trim()
  .min(1, "Phone number is required")
  .transform((value, ctx): string => {
    const normalised = normalizePhone(value);
    if (!normalised) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: US_PHONE_ERROR });
      return z.NEVER;
    }
    return normalised;
  });

/**
 * Optional phone: blank -> null, otherwise the same rule as
 * `requiredPhoneSchema`. Kept for a future genuinely-optional contact field
 * (none left today).
 */
export const optionalPhoneSchema = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx): string | null => {
    if (!value) return null;
    const normalised = normalizePhone(value);
    if (!normalised) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: US_PHONE_ERROR });
      return z.NEVER;
    }
    return normalised;
  });
