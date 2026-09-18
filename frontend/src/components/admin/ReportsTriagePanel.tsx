"use client";

// Admin triage list for public "report a problem" submissions
// (docs/API_CONTRACTS.md "Listing reports"). Each card shows the report and
// lets the admin resolve / dismiss it (or re-open a closed one) with
// optional notes. The status filter and pagination live on the page as real
// links (server-rendered), so this component only owns per-card actions.
import { useState } from "react";
import Link from "next/link";
import { updateReportAction } from "@/app/admin/reports/actions";
import { reportCategoryLabel } from "@/lib/constants/reportCategories";
import type { ListingReport, ReportStatus } from "@/types/listingReport";

interface ReportsTriagePanelProps {
  initialReports: ListingReport[];
  /** Active status filter; a card that no longer matches after an action
   * is dropped from the list. `null` = "All" (nothing is dropped). */
  statusFilter: ReportStatus | null;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_COPY: Record<ReportStatus, string> = {
  new: "New",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

function StatusBadge({ status }: { status: ReportStatus }) {
  const tone =
    status === "resolved"
      ? "bg-brand-success-bg text-brand-success"
      : status === "dismissed"
        ? "bg-brand-closed-bg text-brand-closed"
        : "bg-brand-chip text-brand-chip-ink";
  return (
    <span
      className={`inline-flex items-center rounded-brand-pill px-2.5 py-1 text-xs font-semibold ${tone}`}
    >
      {STATUS_COPY[status]}
    </span>
  );
}

export default function ReportsTriagePanel({
  initialReports,
  statusFilter,
}: ReportsTriagePanelProps) {
  const [reports, setReports] = useState<ListingReport[]>(initialReports);

  function handleUpdated(updated: ListingReport) {
    setReports((prev) =>
      prev.flatMap((r) => {
        if (r.report_id !== updated.report_id) return [r];
        // Drop the card once it no longer matches the active filter.
        return statusFilter === null || updated.status === statusFilter ? [updated] : [];
      })
    );
  }

  if (reports.length === 0) {
    return (
      <div className="rounded-brand-card border border-dashed border-brand-border bg-white px-6 py-12 text-center">
        <p className="font-display text-base font-semibold text-brand-ink">
          Nothing here
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-brand-ink-muted">
          No reports match this filter.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {reports.map((report) => (
        <li key={report.report_id}>
          <ReportCard report={report} onUpdated={handleUpdated} />
        </li>
      ))}
    </ul>
  );
}

function ReportCard({
  report,
  onUpdated,
}: {
  report: ListingReport;
  onUpdated: (report: ListingReport) => void;
}) {
  const [notes, setNotes] = useState(report.reviewer_notes ?? "");
  const [pending, setPending] = useState<ReportStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(status: ReportStatus) {
    setError(null);
    setPending(status);
    try {
      const result = await updateReportAction(report.report_id, status, notes);
      if (result.ok) {
        onUpdated(result.report);
      } else {
        setError(result.error);
      }
    } finally {
      setPending(null);
    }
  }

  const notesId = `report-notes-${report.report_id}`;
  const busy = pending !== null;

  return (
    <article className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold text-brand-ink">
            <Link
              href={`/restaurant/${report.brand_slug}`}
              className="underline-offset-2 hover:underline"
            >
              {report.brand_name}
            </Link>
          </h2>
          {report.location_address && (
            <p className="mt-0.5 text-sm text-brand-ink-muted">{report.location_address}</p>
          )}
        </div>
        <StatusBadge status={report.status} />
      </div>

      <p className="mt-3 inline-flex rounded-brand-pill bg-brand-bg px-3 py-1 text-xs font-semibold text-brand-ink">
        {reportCategoryLabel(report.category)}
      </p>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-brand-ink">
        {report.details}
      </p>

      <dl className="mt-4 grid grid-cols-1 gap-2 rounded-brand-control bg-brand-bg p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-brand-ink-subtle">Submitted</dt>
          <dd className="mt-0.5 font-medium text-brand-ink">
            {formatDateTime(report.submitted_at)}
          </dd>
        </div>
        <div>
          <dt className="text-brand-ink-subtle">Reporter</dt>
          <dd className="mt-0.5 break-all font-medium text-brand-ink">
            {report.reporter_email ??
              (report.reporter_user_id ? "Signed-in user (no email given)" : "Anonymous")}
          </dd>
        </div>
        {report.reviewed_at && (
          <div>
            <dt className="text-brand-ink-subtle">Reviewed</dt>
            <dd className="mt-0.5 font-medium text-brand-ink">
              {formatDateTime(report.reviewed_at)}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-4">
        <label htmlFor={notesId} className="text-sm font-semibold text-brand-ink">
          Notes <span className="font-normal text-brand-ink-subtle">(optional)</span>
        </label>
        <textarea
          id={notesId}
          rows={2}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-2 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none"
        />
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {report.status === "new" ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => act("resolved")}
              className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-success px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending === "resolved" ? "Saving..." : "Mark resolved"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => act("dismissed")}
              className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border px-5 text-sm font-semibold text-brand-ink-muted transition hover:bg-brand-chip disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending === "dismissed" ? "Saving..." : "Dismiss"}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => act("new")}
            className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border px-5 text-sm font-semibold text-brand-ink-muted transition hover:bg-brand-chip disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending === "new" ? "Saving..." : "Re-open"}
          </button>
        )}
      </div>
    </article>
  );
}
