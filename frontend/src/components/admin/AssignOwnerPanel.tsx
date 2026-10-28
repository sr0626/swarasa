"use client";

// "Assign owner" action for an UNCLAIMED brand row on /admin/listings
// (docs/API_CONTRACTS.md "Admin: assign an owner to an unclaimed listing").
// Closed: one 44px button. Open: an inline dialog region to search existing
// owners by email/name (or type the email of a Cognito owner who has no
// owner account yet), pick one, read the confirmation sentence and confirm.
// Pure decisions (target body, labels, copy) live in lib/adminOwnerAssignment.ts.
import { useId, useState } from "react";
import { assignOwnerAction, searchOwnersAction, type OwnerOption } from "@/app/admin/owners/actions";
import {
  assignConfirmText,
  assignTarget,
  looksLikeEmail,
  ownerOptionLabel,
} from "@/lib/adminOwnerAssignment";
import type { AssignOwnerResponse } from "@/types/adminOwnerAssignment";

/** `owner:<id>` = an existing owner from the search; `email` = look up the typed email. */
type Choice = `owner:${number}` | "email";

const INPUT_CLASS =
  "min-h-[44px] w-full rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none";
const SECONDARY_BUTTON =
  "flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border bg-white px-4 text-sm font-semibold text-brand-ink transition hover:bg-brand-chip disabled:cursor-not-allowed disabled:opacity-60";

export default function AssignOwnerPanel({
  brandId,
  brandName,
  onAssigned,
}: {
  brandId: number;
  brandName: string;
  onAssigned: (result: AssignOwnerResponse) => void;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [owners, setOwners] = useState<OwnerOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typedEmail = query.trim().toLowerCase();
  const emailAlreadyListed = (owners ?? []).some(
    (owner) => owner.email?.toLowerCase() === typedEmail
  );
  const offerEmailLookup = looksLikeEmail(query) && !emailAlreadyListed;

  function reset() {
    setOpen(false);
    setQuery("");
    setOwners(null);
    setChoice(null);
    setError(null);
  }

  async function handleSearch() {
    setError(null);
    setChoice(null);
    if (!query.trim()) {
      setOwners(null);
      return;
    }
    setSearching(true);
    try {
      const result = await searchOwnersAction(query);
      if (result.ok) {
        setOwners(result.owners);
      } else {
        setError(result.error);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSearching(false);
    }
  }

  const selectedOwner =
    choice && choice !== "email"
      ? (owners ?? []).find((owner) => `owner:${owner.id}` === choice) ?? null
      : null;
  const target = assignTarget(selectedOwner ? selectedOwner.id : null, choice === "email" ? query : "");
  const targetLabel = selectedOwner
    ? (selectedOwner.email ?? "this owner")
    : choice === "email"
      ? typedEmail
      : "";

  async function handleConfirm() {
    if (!target) return;
    setError(null);
    setAssigning(true);
    try {
      const result = await assignOwnerAction(brandId, target);
      if (result.ok) {
        onAssigned(result.result);
        // The parent swaps this row to "Claimed" and shows the summary;
        // this component unmounts with the button.
        return;
      }
      setError(result.error);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setAssigning(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Assign an owner to ${brandName}`}
        className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-ink px-3 text-xs font-semibold text-brand-bg transition hover:bg-brand-ink/90"
      >
        Assign owner
      </button>
    );
  }

  const titleId = `${uid}-title`;
  const hintId = `${uid}-hint`;
  const inputId = `${uid}-q`;

  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={hintId}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !assigning) reset();
      }}
      className="basis-full rounded-brand-control border border-brand-border bg-brand-bg p-4"
    >
      <p id={titleId} className="text-sm font-semibold text-brand-ink">
        Assign an owner to &ldquo;{brandName}&rdquo;
      </p>
      <p id={hintId} className="mt-1 text-xs text-brand-ink-muted">
        Search owners by email or name. If the person has an owner sign-in but no owner account yet,
        type their full email and choose &ldquo;Look up&rdquo;.
      </p>

      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSearch();
        }}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor={inputId} className="block text-xs font-semibold text-brand-ink">
            Owner email or name
          </label>
          <input
            id={inputId}
            type="search"
            value={query}
            maxLength={100}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setChoice(null);
            }}
            placeholder="owner@example.com"
            className={`mt-1 ${INPUT_CLASS}`}
          />
        </div>
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {searching ? "Searching..." : "Search"}
        </button>
      </form>

      {(owners !== null || offerEmailLookup) && (
        <fieldset className="mt-3">
          <legend className="text-xs font-semibold text-brand-ink">Choose an owner</legend>
          <div className="mt-1 flex flex-col gap-1.5" aria-live="polite">
            {owners !== null && owners.length === 0 && !offerEmailLookup && (
              <p className="text-sm text-brand-ink-muted">No owners match that search.</p>
            )}
            {(owners ?? []).map((owner) => (
              <label
                key={owner.id}
                className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-brand-control border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink"
              >
                <input
                  type="radio"
                  name={`${uid}-choice`}
                  checked={choice === `owner:${owner.id}`}
                  onChange={() => setChoice(`owner:${owner.id}`)}
                  className="h-4 w-4 shrink-0 accent-brand-accent"
                />
                <span className="min-w-0 break-words">{ownerOptionLabel(owner)}</span>
              </label>
            ))}
            {offerEmailLookup && (
              <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-brand-control border border-dashed border-brand-border bg-white px-3 py-2 text-sm text-brand-ink">
                <input
                  type="radio"
                  name={`${uid}-choice`}
                  checked={choice === "email"}
                  onChange={() => setChoice("email")}
                  className="h-4 w-4 shrink-0 accent-brand-accent"
                />
                <span className="min-w-0 break-all">
                  Look up <strong>{typedEmail}</strong> in owner sign-in accounts
                </span>
              </label>
            )}
          </div>
        </fieldset>
      )}

      {target && (
        <p className="mt-3 text-sm text-brand-ink" aria-live="polite">
          {assignConfirmText(brandName, targetLabel)}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!target || assigning}
          className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-ink px-4 text-sm font-semibold text-brand-bg transition hover:bg-brand-ink/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {assigning ? "Assigning..." : "Confirm assignment"}
        </button>
        <button type="button" onClick={reset} disabled={assigning} className={SECONDARY_BUTTON}>
          Cancel
        </button>
      </div>
    </div>
  );
}
