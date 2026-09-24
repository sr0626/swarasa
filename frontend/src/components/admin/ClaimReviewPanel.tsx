"use client";

// Admin claims queue (docs/API_CONTRACTS.md "Claim flow" — `GET /claim`).
// The page loads the list server-side and passes it in; this component owns
// per-card review actions only (approve / reject with reviewer notes). The
// status filter and pagination live on the page as real links.
import { useState } from "react";
import Link from "next/link";
import { approveClaimAction, rejectClaimAction } from "@/app/admin/claims/actions";
import ClaimStatusBadge from "@/components/claim/ClaimStatusBadge";
import { CheckIcon, XIcon } from "@/components/ui/icons";
import type { ClaimQueueItem, ClaimResponse, ClaimStatus } from "@/types/claim";
import { brandHref } from "@/lib/restaurant/urls";

interface ClaimReviewPanelProps {
  initialClaims: ClaimQueueItem[];
  /** Active status filter; a card that no longer matches after an action
   * is dropped from the list. */
  statusFilter: ClaimStatus;
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

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export default function ClaimReviewPanel({
  initialClaims,
  statusFilter,
}: ClaimReviewPanelProps) {
  const [claims, setClaims] = useState<ClaimQueueItem[]>(initialClaims);
  // Claim ids whose approve response came back with `owner_group_granted:
  // false` — the approval itself succeeded, but the claimant may not have
  // portal access yet. Tracked separately from `claims` (not part of the
  // API shape) so the warning can keep a card visible on-screen even after
  // its status no longer matches the active filter tab.
  const [ownerGroupWarnings, setOwnerGroupWarnings] = useState<Set<number>>(new Set());

  function handleResolved(updated: ClaimResponse) {
    const needsWarning = updated.owner_group_granted === false;
    if (needsWarning) {
      setOwnerGroupWarnings((prev) => new Set(prev).add(updated.claim_id));
    }
    setClaims((prev) =>
      prev.flatMap((c) => {
        if (c.claim_id !== updated.claim_id) return [c];
        // Drop the card once it no longer matches the active filter —
        // unless it needs to stay put so the owner-group warning is seen.
        if (updated.status !== statusFilter && !needsWarning) return [];
        return [
          {
            ...c,
            status: updated.status,
            reviewed_at: updated.reviewed_at ?? null,
            reviewer_notes: updated.reviewer_notes ?? null,
          },
        ];
      })
    );
  }

  if (claims.length === 0) {
    return (
      <div className="rounded-brand-card border border-dashed border-brand-border bg-white px-6 py-12 text-center">
        <p className="font-display text-base font-semibold text-brand-ink">Nothing here</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-brand-ink-muted">
          No claims match this filter.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {claims.map((claim) => (
        <li key={claim.claim_id}>
          <ClaimCard
            claim={claim}
            onResolved={handleResolved}
            ownerGroupWarning={ownerGroupWarnings.has(claim.claim_id)}
          />
        </li>
      ))}
    </ul>
  );
}

function ProofLink({ claim }: { claim: ClaimQueueItem }) {
  const linkClass = "break-all font-medium text-brand-accent underline underline-offset-2";

  if (claim.proof_method === "google_business_profile") {
    const url = claim.google_business_profile_url;
    if (!url) return <span className="font-medium text-brand-ink">Not provided</span>;
    return isHttpUrl(url) ? (
      <a href={url} target="_blank" rel="noopener noreferrer" className={linkClass}>
        Google Business Profile
      </a>
    ) : (
      <span className="break-all font-medium text-brand-ink">{url}</span>
    );
  }

  if (claim.proof_method === "document_upload") {
    const doc = claim.supporting_document_url;
    if (!doc) return <span className="font-medium text-brand-ink">Not provided</span>;
    // The API returns the stored key only (no presigned read URL), so it is
    // only a clickable link when the claimant supplied a full http(s) URL.
    return isHttpUrl(doc) ? (
      <a href={doc} target="_blank" rel="noopener noreferrer" className={linkClass}>
        Supporting document
      </a>
    ) : (
      <span className="break-all font-medium text-brand-ink" title="Stored S3 key">
        Document key: {doc}
      </span>
    );
  }

  return (
    <span className="font-medium text-brand-ink">
      Phone call to the number on the listing
    </span>
  );
}

function ClaimCard({
  claim,
  onResolved,
  ownerGroupWarning,
}: {
  claim: ClaimQueueItem;
  onResolved: (claim: ClaimResponse) => void;
  /** True if the approve response came back with `owner_group_granted:
   * false` — approval succeeded, but the claimant may not have portal
   * access yet. */
  ownerGroupWarning: boolean;
}) {
  const [approveNotes, setApproveNotes] = useState("");
  const [rejectNotes, setRejectNotes] = useState("");
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"approve" | "reject" | null>(null);

  const isPending = claim.status === "pending_review";
  const approveId = `approve-notes-${claim.claim_id}`;
  const rejectId = `reject-notes-${claim.claim_id}`;

  async function handleApprove() {
    setActionError(null);
    setPendingAction("approve");
    try {
      const result = await approveClaimAction(claim.claim_id, approveNotes.trim());
      if (result.ok) {
        onResolved(result.claim);
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
      setActionError("Reviewer notes are required to reject a claim.");
      return;
    }
    setPendingAction("reject");
    try {
      const result = await rejectClaimAction(claim.claim_id, rejectNotes.trim());
      if (result.ok) {
        onResolved(result.claim);
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
              href={brandHref(claim.brand_slug)}
              className="underline-offset-2 hover:underline"
            >
              {claim.brand_name}
            </Link>
          </h2>
          {claim.location_address && (
            <p className="mt-0.5 text-sm text-brand-ink-muted">{claim.location_address}</p>
          )}
          <p className="mt-0.5 text-xs text-brand-ink-subtle">Claim #{claim.claim_id}</p>
        </div>
        <ClaimStatusBadge status={claim.status} />
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3 rounded-brand-control bg-brand-bg p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-brand-ink-subtle">Claimant</dt>
          <dd className="mt-0.5 break-all font-medium text-brand-ink">
            {claim.claimant_email ?? "Email unavailable"}
          </dd>
        </div>
        <div>
          <dt className="text-brand-ink-subtle">Proof method</dt>
          <dd className="mt-0.5 font-medium capitalize text-brand-ink">
            {claim.proof_method.replace(/_/g, " ")}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-brand-ink-subtle">Proof</dt>
          <dd className="mt-0.5">
            <ProofLink claim={claim} />
          </dd>
        </div>
        <div>
          <dt className="text-brand-ink-subtle">Submitted</dt>
          <dd className="mt-0.5 font-medium text-brand-ink">
            {formatDateTime(claim.submitted_at)}
          </dd>
        </div>
        <div>
          <dt className="text-brand-ink-subtle">SLA due</dt>
          <dd className="mt-0.5 font-medium text-brand-ink">
            {formatDateTime(claim.sla_due_at)}
          </dd>
        </div>
        {claim.reviewed_at && (
          <div>
            <dt className="text-brand-ink-subtle">Reviewed</dt>
            <dd className="mt-0.5 font-medium text-brand-ink">
              {formatDateTime(claim.reviewed_at)}
            </dd>
          </div>
        )}
        {claim.reviewer_notes && (
          <div className="sm:col-span-2">
            <dt className="text-brand-ink-subtle">Reviewer notes</dt>
            <dd className="mt-0.5 whitespace-pre-wrap break-words font-medium text-brand-ink">
              {claim.reviewer_notes}
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

      {ownerGroupWarning && (
        <p
          role="status"
          className="mt-4 rounded-brand-control bg-brand-chip px-3 py-2.5 text-sm text-brand-ink"
        >
          <span className="font-semibold">Approved, but the claimant could not be added to
          the owner group automatically</span> — they may not have portal access yet. Contact
          them or add the group manually.
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
              {pendingAction === "approve" ? "Approving..." : "Approve claim"}
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
                : "Reject claim"}
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
