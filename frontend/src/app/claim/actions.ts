"use server";

// Server Action backing the claim submission form (ClaimForm.tsx).
//
// JUDGMENT CALL (flagged in final report): frontend/CLAUDE.md's
// "Auth-gated portal pages" pattern reads the Cognito access token
// server-side only (frontend/src/lib/auth/session.ts's getServerSession),
// and root CLAUDE.md says "NEVER store auth tokens in localStorage" —
// the spirit of that rule is that the token shouldn't be handed to
// client-side JS at all if it doesn't have to be. A Server Action lets
// ClaimForm (a Client Component, needed for the interactive proof-method
// switch and controlled inputs) submit form values without ever receiving
// `session.accessToken` as a prop — this action re-reads the session from
// the httpOnly cookie itself and attaches the token to the real API call.
import { ApiError } from "@/lib/api/client";
import { guardHeadersFor } from "@/lib/formGuard/server";
import { guardErrorMessage } from "@/lib/formGuard/guardLogic";
import { submitClaim } from "@/lib/api/claim";
import { getServerSession } from "@/lib/auth/session";
import { createClaimSchema } from "@/lib/validation/claim";
import type { ClaimResponse } from "@/types/claim";

export type SubmitClaimActionResult =
  | { ok: true; claim: ClaimResponse }
  | { ok: false; error: string };

export async function submitClaimAction(
  input: unknown,
  guard?: unknown
): Promise<SubmitClaimActionResult> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }

  const parsed = createClaimSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      ok: false,
      error: firstIssue?.message ?? "Please check the claim details and try again.",
    };
  }

  try {
    const claim = await submitClaim(parsed.data, session.accessToken, guardHeadersFor(guard));
    return { ok: true, claim };
  } catch (error) {
    if (error instanceof ApiError) {
      const guardMessage = guardErrorMessage(error.status, error.code);
      if (guardMessage) return { ok: false, error: guardMessage };
      if (error.status === 409) {
        return {
          ok: false,
          error:
            "This restaurant already has a claim pending review. Only one claim can be in review per listing at a time.",
        };
      }
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: "Something went wrong submitting your claim. Please try again.",
    };
  }
}
