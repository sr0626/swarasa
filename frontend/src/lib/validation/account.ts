// Client-side validation for the account page's CCPA data-deletion request
// form, mirroring POST /auth/me/data-deletion's body (docs/API_CONTRACTS.md
// "Privacy (CCPA data export / deletion)"): `reason` is optional, never
// required. Profile-edit validation reuses the existing
// `updateAuthMeSchema` in lib/validation/auth.ts — no need to duplicate it.
import { z } from "zod";

export const requestDataDeletionSchema = z.object({
  reason: z.string().trim().max(500, "Keep it under 500 characters").optional(),
});

export type RequestDataDeletionFormValues = z.infer<typeof requestDataDeletionSchema>;
