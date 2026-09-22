// Client-side validation for the location status control + reopen-request
// forms, mirroring @/lib/validation/claim.ts's pattern -- the backend
// re-validates independently (app/schemas/location.py LocationStatusUpdate,
// app/schemas/location_reopen.py), this is not a substitute for that.
import { z } from "zod";

export const locationStatusSchema = z.enum([
  "active",
  "owner_deactivated",
  "coming_soon",
  "closed_pending_reopen",
]);

export const updateLocationStatusSchema = z.object({
  status: locationStatusSchema,
});

// Matches backend NOTES_MAX_LENGTH (app/schemas/location_reopen.py).
const NOTES_MAX_LENGTH = 2000;

export const createReopenRequestSchema = z.object({
  notes: z.string().max(NOTES_MAX_LENGTH).optional(),
});

export const rejectReopenRequestSchema = z.object({
  reviewer_notes: z
    .string()
    .min(1, "Reviewer notes are required to reject a reopen request.")
    .max(NOTES_MAX_LENGTH),
});

export const approveReopenRequestSchema = z.object({
  reviewer_notes: z.string().max(NOTES_MAX_LENGTH).optional(),
});
