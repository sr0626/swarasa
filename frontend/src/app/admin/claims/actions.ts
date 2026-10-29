"use server";

// Server Actions backing the admin claims review UI (ClaimReviewPanel.tsx)
// — same "keep the Cognito access token server-side" rationale as
// frontend/src/app/claim/actions.ts. Every action independently re-checks
// `role === "admin"` from the verified session (not just from the page's
// own `requireSession` gate) since a Server Action is a real network
// endpoint Next.js exposes, callable on its own.
import { ApiError } from "@/lib/api/client";
import { approveClaim, rejectClaim, updateClaimNotes } from "@/lib/api/claim";
import { getServerSession } from "@/lib/auth/session";
import {
  approveClaimSchema,
  claimNotesSchema,
  rejectClaimSchema,
} from "@/lib/validation/claim";
import type { ClaimQueueItem, ClaimResponse } from "@/types/claim";

/** The signed-in admin, echoed back on approve/reject so the card can show
 * "Approved by <me>" immediately without another lookup. */
export interface ClaimReviewer {
  sub: string;
  email: string;
}

export type ClaimActionResult =
  | { ok: true; claim: ClaimResponse; reviewer: ClaimReviewer }
  | { ok: false; error: string };

export type ClaimNotesActionResult =
  | { ok: true; claim: ClaimQueueItem }
  | { ok: false; error: string };

async function requireAdminAccessToken(): Promise<
  { ok: true; accessToken: string; reviewer: ClaimReviewer } | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  if (session.role !== "admin") {
    return { ok: false, error: "Only admins can review claims." };
  }
  return {
    ok: true,
    accessToken: session.accessToken,
    reviewer: { sub: session.cognitoSub, email: session.email },
  };
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
    return { ok: true, claim, reviewer: admin.reviewer };
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
    return { ok: true, claim, reviewer: admin.reviewer };
  } catch (error) {
    return { ok: false, error: messageFor(error, `No claim found with id #${claimId}.`) };
  }
}

/** PATCH /claim/{id}/notes — auth: admin. Add/replace the note after review. */
export async function updateClaimNotesAction(
  claimId: number,
  reviewerNotes: string
): Promise<ClaimNotesActionResult> {
  const admin = await requireAdminAccessToken();
  if (!admin.ok) return admin;

  const parsed = claimNotesSchema.safeParse({ reviewer_notes: reviewerNotes });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const claim = await updateClaimNotes(claimId, parsed.data, admin.accessToken);
    return { ok: true, claim };
  } catch (error) {
    return { ok: false, error: messageFor(error, `No claim found with id #${claimId}.`) };
  }
}
