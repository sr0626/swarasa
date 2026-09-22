"use server";

// Server Actions backing the admin reopen-requests review UI
// (ReopenRequestReviewPanel.tsx) — same "keep the Cognito access token
// server-side" rationale, and the same shape, as
// frontend/src/app/admin/claims/actions.ts. Every action independently
// re-checks `role === "admin"` from the verified session (not just the
// page's own `requireSession` gate) since a Server Action is a real
// network endpoint Next.js exposes, callable on its own.
import { ApiError } from "@/lib/api/client";
import { approveReopenRequest, rejectReopenRequest } from "@/lib/api/locationReopen";
import { getServerSession } from "@/lib/auth/session";
import {
  approveReopenRequestSchema,
  rejectReopenRequestSchema,
} from "@/lib/validation/locationReopen";
import type { ReopenRequestResponse } from "@/types/locationReopen";

export type ReopenRequestActionResult =
  | { ok: true; request: ReopenRequestResponse }
  | { ok: false; error: string };

async function requireAdminAccessToken(): Promise<
  { ok: true; accessToken: string } | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  if (session.role !== "admin") {
    return { ok: false, error: "Only admins can review reopen requests." };
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

/** POST /location-reopen-requests/{id}/approve — auth: admin. */
export async function approveReopenRequestAction(
  requestId: number,
  reviewerNotes: string
): Promise<ReopenRequestActionResult> {
  const admin = await requireAdminAccessToken();
  if (!admin.ok) return admin;

  const parsed = approveReopenRequestSchema.safeParse({
    reviewer_notes: reviewerNotes || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const request = await approveReopenRequest(requestId, parsed.data, admin.accessToken);
    return { ok: true, request };
  } catch (error) {
    return { ok: false, error: messageFor(error, `No reopen request found with id #${requestId}.`) };
  }
}

/** POST /location-reopen-requests/{id}/reject — auth: admin. reviewer_notes required. */
export async function rejectReopenRequestAction(
  requestId: number,
  reviewerNotes: string
): Promise<ReopenRequestActionResult> {
  const admin = await requireAdminAccessToken();
  if (!admin.ok) return admin;

  const parsed = rejectReopenRequestSchema.safeParse({ reviewer_notes: reviewerNotes });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Reviewer notes are required to reject a reopen request.",
    };
  }

  try {
    const request = await rejectReopenRequest(requestId, parsed.data, admin.accessToken);
    return { ok: true, request };
  } catch (error) {
    return { ok: false, error: messageFor(error, `No reopen request found with id #${requestId}.`) };
  }
}
