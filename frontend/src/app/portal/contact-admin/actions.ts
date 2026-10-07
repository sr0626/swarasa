"use server";

// Server Action behind the Contact admin form (ContactAdminForm.tsx) — keeps
// the Cognito access token server-side, same rationale as
// admin/reports/actions.ts. Re-checks the role from the verified session on
// every call (a Server Action is a real network endpoint) and validates the
// same length bounds the backend enforces so the user gets a specific
// message instead of a generic 422.
import { ApiError } from "@/lib/api/client";
import { contactAdmin } from "@/lib/api/adminMessages";
import { getServerSession } from "@/lib/auth/session";
import {
  BODY_MAX_LENGTH,
  BODY_MIN_LENGTH,
  SUBJECT_MAX_LENGTH,
  SUBJECT_MIN_LENGTH,
} from "@/types/adminMessage";

export type ContactAdminActionResult = { ok: true } | { ok: false; error: string };

/** POST /contact-admin — auth: owner or manager. */
export async function contactAdminAction(input: {
  subject: string;
  body: string;
  relatedLocationId: number | null;
}): Promise<ContactAdminActionResult> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  if (session.role !== "owner" && session.role !== "manager") {
    return { ok: false, error: "Only owners and managers can contact the admin." };
  }

  const subject = input.subject.trim();
  const body = input.body.trim();
  if (subject.length < SUBJECT_MIN_LENGTH || subject.length > SUBJECT_MAX_LENGTH) {
    return {
      ok: false,
      error: `Subject must be ${SUBJECT_MIN_LENGTH}-${SUBJECT_MAX_LENGTH} characters.`,
    };
  }
  if (body.length < BODY_MIN_LENGTH || body.length > BODY_MAX_LENGTH) {
    return {
      ok: false,
      error: `Message must be ${BODY_MIN_LENGTH}-${BODY_MAX_LENGTH} characters.`,
    };
  }

  try {
    await contactAdmin(
      { subject, body, related_location_id: input.relatedLocationId },
      session.accessToken
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
