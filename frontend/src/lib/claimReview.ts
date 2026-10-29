// Pure helpers for the admin claims review cards (`/admin/claims`) -- kept
// free of React/Next imports so they are unit-testable with `node --test`
// (see claimReview.test.ts).

/** Mirrors the backend cap on `reviewer_notes` (app/schemas/claim.py). */
export const CLAIM_NOTES_MAX_LENGTH = 2000;

/** Length at which the counter turns into a warning. */
export const CLAIM_NOTES_WARN_AT = 1800;

/**
 * Who a review (or a note edit) is attributed to: the resolved email, else a
 * short "admin" label with the first 8 characters of the Cognito sub, else
 * plain "an admin" if even the sub is unknown.
 */
export function reviewerLabel(
  email: string | null | undefined,
  sub: string | null | undefined
): string {
  const cleanEmail = email?.trim();
  if (cleanEmail) return cleanEmail;
  const cleanSub = sub?.trim();
  if (cleanSub) return `admin ${cleanSub.slice(0, 8)}`;
  return "an admin";
}

/**
 * Text before the timestamp on a reviewed card: "Approved by a@x.com on" /
 * "Rejected by admin 1a2b3c4d on". Returns null for a claim that has not been
 * reviewed (pending, or no status we recognise). The caller renders the
 * time with `<LocalDateTime/>` right after this text.
 */
export function reviewedByLead(claim: {
  status: string;
  reviewed_by?: string | null;
  reviewed_by_email?: string | null;
}): string | null {
  const verb =
    claim.status === "approved" ? "Approved" : claim.status === "rejected" ? "Rejected" : null;
  if (!verb) return null;
  return `${verb} by ${reviewerLabel(claim.reviewed_by_email, claim.reviewed_by)}`;
}

/** "Note last edited by a@x.com on" (time rendered by the caller), or null. */
export function notesEditedLead(claim: {
  notes_edited_at?: string | null;
  notes_edited_by?: string | null;
  notes_edited_by_email?: string | null;
}): string | null {
  if (!claim.notes_edited_at) return null;
  return `Note last edited by ${reviewerLabel(claim.notes_edited_by_email, claim.notes_edited_by)}`;
}

export type NotesValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Trims and validates a reviewer note. `required` = rejecting a claim (or
 * editing a rejected claim's note), which needs a non-blank note.
 */
export function validateClaimNotes(raw: string, options: { required: boolean }): NotesValidation {
  const value = raw.trim();
  if (options.required && value.length === 0) {
    return { ok: false, error: "Reviewer notes are required to reject a claim." };
  }
  if (value.length > CLAIM_NOTES_MAX_LENGTH) {
    return {
      ok: false,
      error: `Notes can be at most ${CLAIM_NOTES_MAX_LENGTH} characters (currently ${value.length}).`,
    };
  }
  return { ok: true, value };
}

/** "12 / 2000" counter text for the note fields. */
export function notesCounter(raw: string): string {
  return `${raw.length} / ${CLAIM_NOTES_MAX_LENGTH}`;
}
