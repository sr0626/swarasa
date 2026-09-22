"use client";

// Owner/admin self-service status control for the location editor —
// docs/PROJECT_PLAN.csv "Location status lifecycle". Manager-restricted:
// this component is only ever rendered for an owner or admin session (see
// `/portal/locations/[id]/page.tsx`), same posture as
// LocationManagerAssignment.tsx's owner-only section; the server actions it
// calls re-check the role independently too.
//
// Three self-service targets (active / owner_deactivated / coming_soon) are
// a plain select applied immediately on change — freely reversible both
// ways, so no confirmation needed. "Mark permanently closed" is a separate,
// confirmed action: it's the one-way trip into `closed_pending_reopen`
// (backend/app/models/restaurant_location.py "Location status lifecycle") —
// once there, this control hides the select entirely and shows the
// reopen-request panel instead, since the owner can no longer self-service
// their way back to `active`.
//
// JUDGMENT CALL (flagged for review): there's no `GET` endpoint to fetch
// "the current pending reopen request for this location" (only `GET
// /location-reopen-requests/{id}` by request id, and the admin-only queue
// listing) — adding one felt like scope creep beyond this task's explicit
// backend list. Instead, this relies on the submission call's own 409
// (`reopen_request_already_pending`) to detect an existing pending request,
// and remembers that in local state for the rest of this page view. A
// reload of the page loses that "already pending" message (it would need to
// resubmit once, get the 409 again, to re-discover it) — acceptable for a
// low-frequency admin-reviewed flow, flagged here as a smallest-correct-
// design tradeoff rather than a bug.
import { useState } from "react";
import {
  submitReopenRequestAction,
  updateLocationStatusAction,
} from "@/app/portal/locations/[id]/actions";
import LocationStatusBadge from "@/components/portal/LocationStatusBadge";
import { ClockIcon, EyeOffIcon } from "@/components/ui/icons";
import type { LocationStatus } from "@/types/location";
import type { ReopenRequestResponse } from "@/types/locationReopen";

const SELF_SERVICE_OPTIONS: ReadonlyArray<{ value: LocationStatus; label: string }> = [
  { value: "active", label: "Active — visible to the public" },
  { value: "owner_deactivated", label: "Hidden — temporarily hide this listing" },
  { value: "coming_soon", label: "Coming soon — not open yet" },
];

export default function LocationStatusControl({
  locationId,
  initialStatus,
}: {
  locationId: number;
  initialStatus: LocationStatus;
}) {
  const [status, setStatus] = useState<LocationStatus>(initialStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);

  const [reopenNotes, setReopenNotes] = useState("");
  const [reopenRequest, setReopenRequest] = useState<ReopenRequestResponse | null>(null);
  const [reopenAlreadyPending, setReopenAlreadyPending] = useState(false);
  const [reopenSubmitting, setReopenSubmitting] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);

  async function applyStatus(next: LocationStatus) {
    setError(null);
    setSaving(true);
    try {
      const result = await updateLocationStatusAction(locationId, next);
      if (result.ok) {
        setStatus(result.data.status);
      } else {
        setError(result.error);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSelectChange(next: LocationStatus) {
    await applyStatus(next);
  }

  async function handleMarkClosed() {
    if (!confirmingClose) {
      setConfirmingClose(true);
      return;
    }
    await applyStatus("closed_pending_reopen");
    setConfirmingClose(false);
  }

  async function handleSubmitReopenRequest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setReopenError(null);
    setReopenSubmitting(true);
    try {
      const result = await submitReopenRequestAction(locationId, reopenNotes.trim());
      if (result.ok) {
        setReopenRequest(result.data);
      } else if (result.error.toLowerCase().includes("already pending")) {
        setReopenAlreadyPending(true);
      } else {
        setReopenError(result.error);
      }
    } finally {
      setReopenSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby="location-status-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="location-status-heading" className="font-display text-xl font-bold text-brand-ink">
          Listing status
        </h2>
        <LocationStatusBadge status={status} />
      </div>

      {status !== "closed_pending_reopen" ? (
        <>
          <p className="mt-1 text-sm text-brand-ink-muted">
            Control whether this location is visible on the public site.
          </p>

          <div className="mt-4 flex flex-col gap-2 sm:max-w-sm">
            <label htmlFor="location-status-select" className="text-sm font-semibold text-brand-ink">
              Status
            </label>
            <select
              id="location-status-select"
              value={status}
              disabled={saving}
              onChange={(e) => handleSelectChange(e.target.value as LocationStatus)}
              className="min-h-[44px] rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink focus:border-brand-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              {SELF_SERVICE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
              {error}
            </p>
          )}

          <div className="mt-5 border-t border-brand-border pt-4">
            <p className="flex items-start gap-2 text-sm text-brand-ink-muted">
              <EyeOffIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink-subtle" />
              Permanently closing this location is different from hiding it — once closed, you
              can&apos;t reopen it yourself. You&apos;ll need to submit a reopen request for an
              admin to review.
            </p>
            <button
              type="button"
              onClick={handleMarkClosed}
              disabled={saving}
              className={
                confirmingClose
                  ? "mt-3 flex min-h-[44px] items-center justify-center gap-2 rounded-brand-control bg-brand-closed px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  : "mt-3 flex min-h-[44px] items-center justify-center gap-2 rounded-brand-control border border-brand-closed px-4 text-sm font-semibold text-brand-closed transition hover:bg-brand-closed-bg disabled:cursor-not-allowed disabled:opacity-60"
              }
            >
              {saving && confirmingClose
                ? "Closing..."
                : confirmingClose
                ? "Confirm — permanently close this location"
                : "Mark closed"}
            </button>
            {confirmingClose && (
              <button
                type="button"
                onClick={() => setConfirmingClose(false)}
                className="mt-1 block text-center text-xs font-medium text-brand-ink-subtle underline"
              >
                Cancel
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="mt-4">
          <p className="text-sm text-brand-ink-muted">
            This location is closed and hidden from the public. Only an admin-approved reopen
            request can bring it back — you can&apos;t reopen it directly.
          </p>

          {reopenRequest ? (
            <p className="mt-3 flex items-start gap-2 rounded-brand-control bg-brand-chip px-3 py-2.5 text-sm text-brand-chip-ink">
              <ClockIcon className="mt-0.5 h-4 w-4 shrink-0" />
              Reopen request submitted — pending admin review.
            </p>
          ) : reopenAlreadyPending ? (
            <p className="mt-3 flex items-start gap-2 rounded-brand-control bg-brand-chip px-3 py-2.5 text-sm text-brand-chip-ink">
              <ClockIcon className="mt-0.5 h-4 w-4 shrink-0" />
              A reopen request is already pending admin review for this location.
            </p>
          ) : (
            <form onSubmit={handleSubmitReopenRequest} className="mt-4 flex flex-col gap-2">
              <label htmlFor="reopen-notes" className="text-sm font-semibold text-brand-ink">
                Request to reopen
              </label>
              <textarea
                id="reopen-notes"
                value={reopenNotes}
                onChange={(e) => setReopenNotes(e.target.value)}
                placeholder="Optional: let the admin know why this should reopen (e.g. renovation finished)."
                rows={3}
                maxLength={2000}
                className="w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none"
              />
              <button
                type="submit"
                disabled={reopenSubmitting}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {reopenSubmitting ? "Submitting..." : "Submit reopen request"}
              </button>
              {reopenError && (
                <p className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
                  {reopenError}
                </p>
              )}
            </form>
          )}
        </div>
      )}
    </section>
  );
}
