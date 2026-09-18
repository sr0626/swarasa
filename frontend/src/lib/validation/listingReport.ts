// Client/Server-Action-side validation for the report-a-problem form,
// mirroring POST /reports' body in docs/API_CONTRACTS.md. The backend
// re-validates independently; this only gives fast, friendly feedback.
import { z } from "zod";

export const REPORT_DETAILS_MAX_LENGTH = 2000;

export const reportCategorySchema = z.enum([
  "address_incorrect",
  "hours_incorrect",
  "phone_incorrect",
  "price_incorrect",
  "menu_incorrect",
  "permanently_closed",
  "other",
]);

export const createReportSchema = z.object({
  brand_id: z.number().int().positive(),
  location_id: z.number().int().positive().optional(),
  category: reportCategorySchema,
  details: z
    .string()
    .trim()
    .min(1, "Please tell us what's wrong.")
    .max(
      REPORT_DETAILS_MAX_LENGTH,
      `Please keep your description under ${REPORT_DETAILS_MAX_LENGTH} characters.`
    ),
  // Blank is fine (optional); a non-blank value must look like an email.
  reporter_email: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .email("That email address doesn't look right.")
        .max(254, "That email address is too long."),
    ])
    .nullable()
    .optional(),
  // Honeypot — validated only for length so a bot can't smuggle a huge value.
  website: z.string().max(500).optional(),
});

export type CreateReportFormValues = z.infer<typeof createReportSchema>;
