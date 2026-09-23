// Client-side validation mirroring POST/PATCH /locations/{id}/deals
// (docs/API_CONTRACTS.md "Deals (`deal`)", backend/app/schemas/deal.py).
import { z } from "zod";

export const DEAL_TITLE_MAX_LENGTH = 255;
export const DEAL_DESCRIPTION_MAX_LENGTH = 2000;

/**
 * `applicable_days`: 0=Monday..6=Sunday, matching `@/types/location`'s
 * `DayOfWeek` / `LocationHoursEditor`'s day picker. An empty selection means
 * "every day" in this form's own UI (no days highlighted = no restriction)
 * and is sent as `null`, mirroring backend/app/schemas/deal.py's
 * `_validate_applicable_days` — the backend rejects an explicit `[]`, so
 * this never sends one. A non-empty selection is de-duplicated and sorted,
 * same as the backend does server-side.
 */
export const applicableDaysSchema = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .transform((value): number[] | null => {
    if (value.length === 0) return null;
    return Array.from(new Set(value)).sort((a, b) => a - b);
  });

/**
 * `start_at`/`end_at` come from `<input type="datetime-local">`
 * ("YYYY-MM-DDTHH:MM", no timezone) and are converted to a real ISO instant
 * via `new Date(value).toISOString()` at the browser's own local timezone —
 * there is no established pattern elsewhere in this codebase for entering a
 * timestamp in the *location's* timezone specifically (LocationHoursEditor's
 * time inputs are plain wall-clock HH:MM with no date/timezone conversion at
 * all), so this uses the simplest correct option rather than inventing a new
 * one. Flagged in the PR description as a follow-up worth a closer look if
 * an owner and their location turn out to be in different timezones often.
 */
const optionalDateTimeSchema = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx): string | null => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid date and time" });
      return z.NEVER;
    }
    return parsed.toISOString();
  });

// Base object shape, kept separate from the cross-field `superRefine` below
// so `.partial()` stays available (same reason `updateLocationSchema` in
// lib/validation/location.ts is built off a plain object, not a refined
// one — `ZodEffects` from `.superRefine`/`.refine` has no `.partial()`).
const dealFormShape = z.object({
  deal_type: z.enum(["deal", "special"]),
  title: z.string().trim().min(1, "Title is required").max(DEAL_TITLE_MAX_LENGTH),
  description: z
    .string()
    .trim()
    .max(DEAL_DESCRIPTION_MAX_LENGTH, `Description must be at most ${DEAL_DESCRIPTION_MAX_LENGTH} characters`)
    .nullish()
    .transform((value) => value || null),
  applicable_days: applicableDaysSchema,
  start_at: optionalDateTimeSchema,
  end_at: optionalDateTimeSchema,
  is_active: z.boolean(),
});

function checkDateRange(
  value: { start_at?: string | null; end_at?: string | null },
  ctx: z.RefinementCtx
) {
  if (value.start_at && value.end_at && new Date(value.start_at) >= new Date(value.end_at)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Start date/time must be before end date/time",
      path: ["end_at"],
    });
  }
}

export const dealFormSchema = dealFormShape.superRefine(checkDateRange);

export type DealFormValues = z.infer<typeof dealFormSchema>;

// PATCH body — every field optional (an omitted key leaves the stored value
// untouched, matching `DealUpdate`'s `exclude_unset` convention). The form
// itself always sends every field it manages (a full replacement each
// save), so this is really "same shape, optional" rather than a true
// partial-update UI — kept as `.partial()` anyway so the type matches
// `UpdateDealInput` exactly.
export const updateDealFormSchema = dealFormShape.partial().superRefine(checkDateRange);

export type UpdateDealFormValues = z.infer<typeof updateDealFormSchema>;
