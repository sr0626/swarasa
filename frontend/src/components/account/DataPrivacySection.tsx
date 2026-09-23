"use client";

// CCPA data export / deletion UI — the natural home for it per the task
// brief, since backend (PR #70) has been Done with zero frontend UI until
// this page. Available to every role (own data only).
//
// "Delete my account" is deliberately NOT an instant destructive action:
// docs/DECISIONS.md "CCPA data export/deletion" models this as an
// admin-reviewed queue (same pattern as the /claim flow), not self-service
// instant execution — `POST /auth/me/data-deletion` only ever creates a
// `pending_review` request. The copy and the confirm step below are
// written to match that: "submit a request", never "delete now". A
// destructive-*feeling* action still gets an explicit confirm step even
// though nothing irreversible happens synchronously (task brief).
import { useState } from "react";
import { exportMyDataAction, requestDataDeletionAction } from "@/app/account/actions";
import { DownloadIcon, TrashIcon } from "@/components/ui/icons";
import type { DataDeletionRequest } from "@/types/privacy";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusCopy(status: string): string {
  switch (status) {
    case "pending_review":
      return "Pending admin review";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "completed":
      return "Completed";
    default:
      return status;
  }
}

export default function DataPrivacySection({
  latestDeletionRequest,
}: {
  latestDeletionRequest: DataDeletionRequest | null;
}) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [request, setRequest] = useState<DataDeletionRequest | null>(latestDeletionRequest);

  const hasPendingRequest = request?.status === "pending_review";

  async function handleExport() {
    setExportError(null);
    setExporting(true);
    try {
      const result = await exportMyDataAction();
      if (!result.ok) {
        setExportError(result.error);
        return;
      }
      const blob = new Blob([JSON.stringify(result.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `swarasa-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function handleSubmitDeletion() {
    setDeleteError(null);
    setSubmitting(true);
    try {
      const result = await requestDataDeletionAction({ reason: reason.trim() || undefined });
      if (result.ok) {
        setRequest(result.data);
        setConfirmingDelete(false);
        setReason("");
      } else {
        setDeleteError(result.error);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby="privacy-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <h2 id="privacy-heading" className="font-display text-xl font-bold text-brand-ink">
        Your data
      </h2>
      <p className="mt-1 text-sm text-brand-ink-muted">
        Download a copy of your personal data, or request that it be deleted. Covers this app&apos;s
        own database only — your Cognito sign-in account (email, password) is managed separately.
      </p>

      <div className="mt-4 border-t border-brand-border pt-4">
        <h3 className="text-sm font-semibold text-brand-ink">Download my data</h3>
        <p className="mt-1 text-sm text-brand-ink-muted">
          Get a JSON file of everything tied to your account — profile, follows, manager
          assignments, claims, and your own recent activity. Registered users
          also get the searches they ran and the restaurants they clicked while signed in (kept for 12
          months).
        </p>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="mt-3 flex min-h-[44px] items-center justify-center gap-2 rounded-brand-control border border-brand-border bg-white px-5 text-sm font-semibold text-brand-ink transition hover:border-brand-ink-subtle disabled:cursor-not-allowed disabled:opacity-60"
        >
          <DownloadIcon className="h-4 w-4" />
          {exporting ? "Preparing download..." : "Download my data"}
        </button>
        {exportError && (
          <p role="alert" className="mt-2 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
            {exportError}
          </p>
        )}
      </div>

      <div className="mt-5 rounded-brand-control border border-dashed border-brand-closed/40 bg-brand-closed-bg/40 p-4 sm:p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-brand-closed">
          <TrashIcon className="h-4 w-4" />
          Delete my account
        </h3>

        {request && (
          <p className="mt-2 text-sm text-brand-ink-muted">
            Latest request: <span className="font-semibold text-brand-ink">{statusCopy(request.status)}</span>
            {" "}— submitted {formatDateTime(request.submitted_at)}.
            {request.status === "pending_review" &&
              " An admin will review it before anything is removed."}
            {request.status === "rejected" && request.reviewer_notes && (
              <> Reviewer note: {request.reviewer_notes}</>
            )}
          </p>
        )}

        <p className="mt-2 text-sm text-brand-ink-muted">
          This <strong>submits a request</strong> for an admin to review — it does not delete
          anything immediately. You&apos;ll keep access to your account while it&apos;s pending.
        </p>

        {!confirmingDelete && (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={hasPendingRequest}
            className="mt-3 flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-closed px-5 text-sm font-semibold text-brand-closed transition hover:bg-brand-closed-bg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {hasPendingRequest ? "Deletion request already pending" : "Request account deletion"}
          </button>
        )}

        {confirmingDelete && (
          <div className="mt-3 rounded-brand-control border border-brand-closed bg-white p-4">
            <p role="alert" className="text-sm font-semibold text-brand-closed">
              Are you sure? This submits a deletion request for admin review — it can&apos;t be
              undone once approved.
            </p>

            <label htmlFor="deletion-reason" className="mt-3 block text-sm font-semibold text-brand-ink">
              Reason (optional)
            </label>
            <textarea
              id="deletion-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="mt-1.5 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none"
              placeholder="Let us know why you're leaving (optional)"
            />

            {deleteError && (
              <p role="alert" className="mt-2 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
                {deleteError}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSubmitDeletion}
                disabled={submitting}
                className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-closed px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Submitting..." : "Yes, submit deletion request"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                  setDeleteError(null);
                }}
                disabled={submitting}
                className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border bg-white px-5 text-sm font-semibold text-brand-ink transition hover:border-brand-ink-subtle"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
