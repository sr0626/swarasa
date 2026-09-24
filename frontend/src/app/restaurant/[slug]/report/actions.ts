"use server";

// Server Action backing the public report-a-problem form
// (ReportProblemForm.tsx). Unlike app/claim/actions.ts this route is
// PUBLIC — no session is required. If the visitor happens to be signed in,
// the access token is read here (server-side, from the httpOnly cookie, so
// it never reaches client JS) purely so the backend can attribute the
// report; if that token turns out to be stale (the backend 401s a
// present-but-invalid token on optional-auth routes), we retry once
// anonymously rather than blocking the visitor from reporting.
import { ApiError } from "@/lib/api/client";
import { submitReport } from "@/lib/api/listingReports";
import { getServerSession } from "@/lib/auth/session";
import { createReportSchema } from "@/lib/validation/listingReport";
import type { CreateReportInput } from "@/types/listingReport";

export type SubmitReportActionResult = { ok: true } | { ok: false; error: string };

export async function submitReportAction(
  input: unknown
): Promise<SubmitReportActionResult> {
  const parsed = createReportSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ??
        "Please check what you entered and try again.",
    };
  }

  const session = await getServerSession().catch(() => null);

  // Signed in: never forward a client-supplied email. The backend takes the
  // email from the verified token for an authenticated caller and ignores
  // the body field anyway; dropping it here too keeps the two consistent.
  const body: CreateReportInput = {
    ...parsed.data,
    reporter_email: session ? null : parsed.data.reporter_email || null,
  };

  try {
    try {
      await submitReport(body, session?.accessToken ?? null);
    } catch (error) {
      if (session && error instanceof ApiError && error.status === 401) {
        await submitReport(body, null);
      } else {
        throw error;
      }
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) {
        return {
          ok: false,
          error: "We couldn't find that restaurant. It may have been removed.",
        };
      }
      if (error.status === 400 || error.status === 422) {
        return { ok: false, error: "Please check what you entered and try again." };
      }
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: "Something went wrong sending your report. Please try again.",
    };
  }
}
