"use server";

// Server Actions backing the admin claims review UI (ClaimReviewPanel.tsx)
// — same "keep the Cognito access token server-side" rationale as
// frontend/src/app/claim/actions.ts. Every action independently re-checks
// `role === "admin"` from the verified session (not just from the page's
// own `requireSession` gate) since a Server Action is a real network
// endpoint Next.js exposes, callable on its own.
import { ApiError } from "@/lib/api/client";
import { approveClaim, rejectClaim } from "@/lib/api/claim";
import { getServerSession } from "@/lib/auth/session";
import { approveClaimSchema, rejectClaimSchema } from "@/lib/validation/claim";
import type { ClaimResponse } from "@/types/claim";

export type ClaimActionResult =
  | { ok: true; claim: ClaimResponse }
  | { ok: false; error: string };

async function requireAdminAccessToken(): Promise<
  { ok: true; accessToken: string } | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  if (session.role !== "admin") {
    return { ok: false, error: "Only admins can review claims." };
  }
  return { ok: true, accessToken: session.accessToken };
}

function messageFor(error: unknown, notFoundMessage: string): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return notFoundMessage;
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

/** POST /claim/{id}/approve — auth: admin. */
export async function approveClaimAction(
  claimId: number,
  reviewerNotes: string
): Promise<ClaimActionResult> {
  const admin = await requireAdminAccessToken();
  if (!admin.ok) return admin;

  const parsed = approveClaimSchema.safeParse({
    reviewer_notes: reviewerNotes || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const claim = await approveClaim(claimId, parsed.data, admin.accessToken);
    return { ok: true, claim };
  } catch (error) {
    return { ok: false, error: messageFor(error, `No claim found with id #${claimId}.`) };
  }
}

/** POST /claim/{id}/reject — auth: admin. reviewer_notes is required. */
export async function rejectClaimAction(
  claimId: number,
  reviewerNotes: string
): Promise<ClaimActionResult> {
  const admin = await requireAdminAccessToken();
  if (!admin.ok) return admin;

  const parsed = rejectClaimSchema.safeParse({ reviewer_notes: reviewerNotes });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Reviewer notes are required to reject a claim.",
    };
  }

  try {
    const claim = await rejectClaim(claimId, parsed.data, admin.accessToken);
    return { ok: true, claim };
  } catch (error) {
    return { ok: false, error: messageFor(error, `No claim found with id #${claimId}.`) };
  }
}
