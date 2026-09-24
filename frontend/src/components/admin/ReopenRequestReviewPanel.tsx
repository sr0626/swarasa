"use client";

// Admin reopen-requests queue (docs/API_CONTRACTS.md "Location reopen
// requests" — `GET /location-reopen-requests`). Same shape as
// components/admin/ClaimReviewPanel.tsx: the page loads the list
// server-side and passes it in, this component owns per-card review
// actions only (approve / reject with reviewer notes). Approving flips the
// location back to `active` server-side (location_reopen_service.py) — no
// separate confirmation here beyond the reviewer-notes input, since the
// real irreversible-feeling step already happened on the owner's side
// (marking it closed) and this is the review, not a second destructive
// action.
import { useState } from "react";
import Link from "next/link";
import {
  approveReopenRequestAction,
  rejectReopenRequestAction,
} from "@/app/admin/reopen-requests/actions";
import ReopenRequestStatusBadge from "@/components/locationReopen/ReopenRequestStatusBadge";
import { CheckIcon, XIcon } from "@/components/ui/icons";
import type {
  ReopenRequestQueueItem,
  ReopenRequestResponse,
  ReopenRequestStatus,
} from "@/types/locationReopen";
import { locationHref } from "@/lib/restaurant/urls";

interface ReopenRequestReviewPanelProps {
  initialRequests: ReopenRequestQueueItem[];
  statusFilter: ReopenRequestStatus;
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

export default function ReopenRequestReviewPanel({
  initialRequests,
  statusFilter,
}: ReopenRequestReviewPanelProps) {
  const [requests, setRequests] = useState<ReopenRequestQueueItem[]>(initialRequests);

  function handleResolved(updated: ReopenRequestResponse) {
    setRequests((prev) =>
      prev.flatMap((r) => {
        if (r.request_id !== updated.request_id) return [r];
        if (updated.status !== statusFilter) return [];
        return [
          {
            ...r,
            status: updated.status,
            reviewed_at: updated.reviewed_at ?? null,
            reviewer_notes: updated.reviewer_notes ?? null,
          },
        ];
      })
    );
  }

  if (requests.length === 0) {
    return (
      <div className="rounded-brand-card border border-dashed border-brand-border bg-white px-6 py-12 text-center">
        <p className="font-display text-base font-semibold text-brand-ink">Nothing here</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-brand-ink-muted">
          No reopen requests match this filter.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {requests.map((request) => (
        <li key={request.request_id}>
          <ReopenRequestCard request={request} onResolved={handleResolved} />
        </li>
      ))}
    </ul>
  );
}

function ReopenRequestCard({
  request,
  onResolved,
}: {
  request: ReopenRequestQueueItem;
  onResolved: (request: ReopenRequestResponse) => void;
}) {
  const [approveNotes, setApproveNotes] = useState("");
  const [rejectNotes, setRejectNotes] = useState("");
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"approve" | "reject" | null>(null);

  const isPending = request.status === "pending_review";
  const approveId = `approve-notes-${request.request_id}`;
  const rejectId = `reject-notes-${request.request_id}`;

  async function handleApprove() {
    setActionError(null);
    setPendingAction("approve");
    try {
      const result = await approveReopenRequestAction(request.request_id, approveNotes.trim());
      if (result.ok) {
        onResolved(result.request);
      } else {
        setActionError(result.error);
      }
    } catch {
      setActionError("Something went wrong. Please try again.");
    } finally {
      setPendingAction(null);
    }
  }

  async function handleReject() {
    if (!confirmingReject) {
      setConfirmingReject(true);
      return;
    }
    setActionError(null);
    if (!rejectNotes.trim()) {
      setActionError("Reviewer notes are required to reject a reopen request.");
      return;
    }
    setPendingAction("reject");
    try {
      const result = await rejectReopenRequestAction(request.request_id, rejectNotes.trim());
      if (result.ok) {
        onResolved(result.request);
        setConfirmingReject(false);
      } else {
        setActionError(result.error);
      }
    } catch {
      setActionError("Something went wrong. Please try again.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <article className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold text-brand-ink">
            <Link
              href={locationHref(request.brand_slug, request.location_slug)}
              className="underline-offset-2 hover:underline"
            >
              {request.brand_name}
            </Link>
          </h2>
          <p className="mt-0.5 text-sm text-brand-ink-muted">{request.location_address}</p>
          <p className="mt-0.5 text-xs text-brand-ink-subtle">Request #{request.request_id}</p>
        </div>
        <ReopenRequestStatusBadge status={request.status} />
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3 rounded-brand-control bg-brand-bg p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-brand-ink-subtle">Requested by</dt>
          <dd className="mt-0.5 break-all font-medium text-brand-ink">
            {request.requester_email ?? "Email unavailable"}
          </dd>
        </div>
        <div>
          <dt className="text-brand-ink-subtle">Submitted</dt>
          <dd className="mt-0.5 font-medium text-brand-ink">{formatDateTime(request.submitted_at)}</dd>
        </div>
        {request.notes && (
          <div className="sm:col-span-2">
            <dt className="text-brand-ink-subtle">Owner&apos;s notes</dt>
            <dd className="mt-0.5 whitespace-pre-wrap break-words font-medium text-brand-ink">
              {request.notes}
            </dd>
          </div>
        )}
        {request.reviewed_at && (
          <div>
            <dt className="text-brand-ink-subtle">Reviewed</dt>
            <dd className="mt-0.5 font-medium text-brand-ink">{formatDateTime(request.reviewed_at)}</dd>
          </div>
        )}
        {request.reviewer_notes && (
          <div className="sm:col-span-2">
            <dt className="text-brand-ink-subtle">Reviewer notes</dt>
            <dd className="mt-0.5 whitespace-pre-wrap break-words font-medium text-brand-ink">
              {request.reviewer_notes}
            </dd>
          </div>
        )}
      </dl>

      {actionError && (
        <p
          role="alert"
          className="mt-4 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {actionError}
        </p>
      )}

      {isPending && (
        <div className="mt-5 flex flex-col gap-4 border-t border-brand-border pt-5 sm:flex-row">
          <div className="flex-1">
            <label htmlFor={approveId} className="text-sm font-semibold text-brand-ink">
              Approve
            </label>
            <input
              id={approveId}
              type="text"
              value={approveNotes}
              onChange={(e) => setApproveNotes(e.target.value)}
              placeholder="Reviewer notes (optional)"
              className="mt-2 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={handleApprove}
              disabled={pendingAction !== null}
              className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-brand-control bg-brand-success px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CheckIcon className="h-4 w-4" />
              {pendingAction === "approve" ? "Approving..." : "Approve — reopen location"}
            </button>
          </div>

          <div className="flex-1">
            <label htmlFor={rejectId} className="text-sm font-semibold text-brand-ink">
              Reject
            </label>
            <input
              id={rejectId}
              type="text"
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              placeholder="Reviewer notes (required)"
              className="mt-2 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={handleReject}
              disabled={pendingAction !== null}
              className={
                confirmingReject
                  ? "mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-brand-control bg-brand-closed px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  : "mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-brand-control border border-brand-closed px-4 text-sm font-semibold text-brand-closed transition hover:bg-brand-closed-bg disabled:cursor-not-allowed disabled:opacity-60"
              }
            >
              <XIcon className="h-4 w-4" />
              {pendingAction === "reject"
                ? "Rejecting..."
                : confirmingReject
                ? "Confirm reject"
                : "Reject request"}
            </button>
            {confirmingReject && (
              <button
                type="button"
                onClick={() => setConfirmingReject(false)}
                className="mt-1 w-full text-center text-xs font-medium text-brand-ink-subtle underline"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
