"use client";

// Admin Listings row control: set / clear a location's "Subscribed until
// <date>" by hand (PUT /admin/locations/{id}/subscription). Clearly labelled
// MANUAL — no payment is taken; it is the stand-in for a real subscription
// until a payment processor exists, and what makes a location selectable for
// catering quote requests. Every change goes through an explicit confirm step.
import { useState } from "react";
import { setManualSubscriptionAction } from "@/lib/actions/catering";
import {
  datePart,
  describeSubscription,
  MANUAL_LABEL,
  validateUntilDate,
} from "@/lib/catering/subscription";

function localTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Pending = { isPaid: boolean; until: string | null } | null;

export default function LocationSubscriptionControl({
  locationId,
  isPaid: initialPaid,
  paidUntil: initialUntil,
}: {
  locationId: number;
  isPaid: boolean;
  paidUntil: string | null;
}) {
  const [isPaid, setIsPaid] = useState(initialPaid);
  const [paidUntil, setPaidUntil] = useState(initialUntil);
  const [open, setOpen] = useState(false);
  const [dateInput, setDateInput] = useState(initialUntil ? datePart(initialUntil) : "");
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = describeSubscription(isPaid, paidUntil);
  const btn =
    "flex min-h-[44px] items-center justify-center rounded-brand-control px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";

  function ask(nextPaid: boolean) {
    setError(null);
    if (nextPaid) {
      const problem = validateUntilDate(dateInput, localTodayIso());
      if (problem) {
        setError(problem);
        return;
      }
    }
    setPending({ isPaid: nextPaid, until: nextPaid && dateInput ? dateInput : null });
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const result = await setManualSubscriptionAction(locationId, pending.isPaid, pending.until);
    setBusy(false);
    if (result.ok) {
      setIsPaid(result.data.is_paid);
      setPaidUntil(result.data.paid_until);
      setDateInput(result.data.paid_until ? datePart(result.data.paid_until) : "");
      setPending(null);
    } else {
      setError(result.error);
      setPending(null);
    }
  }

  return (
    <div className="mt-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            status.subscribed
              ? "inline-flex items-center rounded-brand-pill bg-brand-accent-gold/30 px-2 py-0.5 font-semibold text-brand-chip-ink"
              : "inline-flex items-center rounded-brand-pill bg-brand-bg px-2 py-0.5 font-semibold text-brand-ink-subtle ring-1 ring-brand-border"
          }
        >
          {status.text}
        </span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="min-h-[44px] px-1 font-semibold text-brand-ink underline"
        >
          {open ? "Hide subscription" : "Manage subscription"}
        </button>
      </div>

      {open && (
        <div className="mt-1 rounded-brand-control border border-brand-border bg-white p-3">
          <p className="font-semibold text-brand-closed">{MANUAL_LABEL}</p>
          <p className="mt-1 text-brand-ink-subtle">
            Sets the paid flag by hand. Leave the date empty for no end date.
          </p>
          <label htmlFor={`sub-until-${locationId}`} className="mt-2 block font-semibold text-brand-ink">
            Subscribed until
          </label>
          <input
            id={`sub-until-${locationId}`}
            type="date"
            value={dateInput}
            min={localTodayIso()}
            disabled={busy || pending !== null}
            onChange={(e) => setDateInput(e.target.value)}
            className="mt-1 min-h-[44px] w-full rounded-brand-control border border-brand-border bg-white px-3 text-base text-brand-ink focus:border-brand-accent focus:outline-none sm:w-auto sm:text-sm"
          />

          {pending ? (
            <div role="alertdialog" aria-label="Confirm manual subscription change" className="mt-3">
              <p className="font-semibold text-brand-ink">
                {pending.isPaid
                  ? `Mark this location subscribed ${pending.until ? `until ${pending.until}` : "with no end date"}? ${MANUAL_LABEL}.`
                  : "Clear the subscription for this location? It will stop appearing for catering requests."}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={confirm}
                  disabled={busy}
                  className={`${btn} bg-brand-accent text-white hover:bg-brand-accent-hover`}
                >
                  {busy ? "Saving..." : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  disabled={busy}
                  className={`${btn} border border-brand-border text-brand-ink-muted hover:bg-brand-chip`}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => ask(true)}
                className={`${btn} bg-brand-ink text-brand-bg hover:opacity-90`}
              >
                {isPaid ? "Update subscription" : "Set subscribed"}
              </button>
              {isPaid && (
                <button
                  type="button"
                  onClick={() => ask(false)}
                  className={`${btn} border border-brand-closed text-brand-closed hover:bg-brand-closed-bg`}
                >
                  Clear subscription
                </button>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="mt-2 text-brand-closed">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
