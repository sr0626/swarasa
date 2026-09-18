"use server";

// Server Action backing the admin report triage UI (ReportsTriagePanel.tsx)
// — same "keep the Cognito access token server-side" rationale as
// admin/claims/actions.ts. Re-checks `role === "admin"` from the verified
// session on every call, since a Server Action is a real network endpoint
// callable on its own, independent of the page's own `requireSession` gate.
import { ApiError } from "@/lib/api/client";
import { updateReport } from "@/lib/api/listingReports";
import { getServerSession } from "@/lib/auth/session";
import type { ListingReport, ReportStatus } from "@/types/listingReport";

export type UpdateReportActionResult =
  | { ok: true; report: ListingReport }
  | { ok: false; error: string };

const MAX_NOTES_LENGTH = 2000;

/** PATCH /reports/{id} — auth: admin. */
export async function updateReportAction(
  reportId: number,
  status: ReportStatus,
  reviewerNotes: string
): Promise<UpdateReportActionResult> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  if (session.role !== "admin") {
    return { ok: false, error: "Only admins can review reports." };
  }
  if (!["new", "resolved", "dismissed"].includes(status)) {
    return { ok: false, error: "Unknown report status." };
  }
  const notes = reviewerNotes.trim();
  if (notes.length > MAX_NOTES_LENGTH) {
    return {
      ok: false,
      error: `Please keep notes under ${MAX_NOTES_LENGTH} characters.`,
    };
  }

  try {
    const report = await updateReport(
      reportId,
      { status, reviewer_notes: notes === "" ? null : notes },
      session.accessToken
    );
    return { ok: true, report };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) {
        return { ok: false, error: `No report found with id #${reportId}.` };
      }
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
