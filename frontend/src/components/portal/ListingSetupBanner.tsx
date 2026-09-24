"use client";

// "Not live yet" banner + setup checklist on the location editor, shown while a
// listing is in `coming_soon` — i.e. right after "Add restaurant" / "Add
// location" (docs/DECISIONS.md "New manual listings start in setup"). It says
// plainly the listing is NOT public, lists what's still needed ("To go live:
// add your opening hours, …") with a jump link per item, and holds the
// "Activate listing" button — disabled and explained until nothing is missing.
//
// The list comes from the server (`LocationDetail.setup_missing`); the hours and
// details forms call `router.refresh()` after a save, which re-renders this with
// the new list. The button is only a convenience: `POST /locations/{id}/status`
// re-checks and answers 422 `listing_incomplete` if anything's still missing,
// and that message is shown as-is. Only an owner or admin can activate (same as
// the status menu); a manager sees the checklist without the button.
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { updateLocationStatusAction } from "@/app/portal/locations/[id]/actions";
import { CheckIcon } from "@/components/ui/icons";
import { isInSetup, setupChecklist, setupSummary } from "@/lib/portal/listingSetup";
import type { LocationStatus } from "@/types/location";

const ANCHOR: Record<"hours" | "info", string> = { hours: "sec-hours", info: "sec-info" };

export default function ListingSetupBanner({
  locationId,
  status,
  setupMissing,
  role,
}: {
  locationId: number;
  status: LocationStatus;
  setupMissing: string[];
  role: string;
}) {
  const router = useRouter();
  const helpId = useId();
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isInSetup(status)) return null;

  const items = setupChecklist(setupMissing);
  const summary = setupSummary(setupMissing);
  const ready = summary === null;
  const canAct = role === "owner" || role === "admin";

  async function activate() {
    setError(null);
    setActivating(true);
    try {
      const result = await updateLocationStatusAction(locationId, "active");
      if (result.ok) {
        // The action revalidates the page; refresh re-renders it as a live
        // listing (this banner disappears, the status chip reads "Active").
        router.refresh();
      } else {
        setError(result.error);
        setActivating(false);
        router.refresh();
      }
    } catch {
      setError("Something went wrong activating this listing. Please try again.");
      setActivating(false);
    }
  }

  return (
    <section
      aria-labelledby="setup-heading"
      data-testid="listing-setup-banner"
      className="mt-4 rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <h2 id="setup-heading" className="font-display text-lg font-bold text-brand-ink">
        This listing isn&rsquo;t live yet
      </h2>
      <p className="mt-1 text-sm text-brand-ink-muted">
        Only the owner, its managers and admins can see it for now — it stays hidden from search and
        the public page until it&rsquo;s activated.
      </p>

      <ul className="mt-4 flex flex-col gap-1" aria-label="Setup checklist">
        {items.map((item) => (
          <li key={item.key} className="flex min-h-[44px] items-center gap-3 text-sm">
            <span
              aria-hidden="true"
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                item.done
                  ? "border-brand-success bg-brand-success-bg text-brand-success"
                  : "border-brand-border bg-white text-transparent"
              }`}
            >
              <CheckIcon className="h-3.5 w-3.5" />
            </span>
            <span className={item.done ? "text-brand-ink-muted" : "font-semibold text-brand-ink"}>
              {item.label}
              <span className="sr-only">{item.done ? " — done" : " — still needed"}</span>
            </span>
            {!item.done && (
              <a
                href={`#${ANCHOR[item.sectionId]}`}
                className="ml-auto text-sm font-semibold text-brand-accent underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              >
                Add
              </a>
            )}
          </li>
        ))}
      </ul>

      {summary && (
        <p id={helpId} role="status" className="mt-3 text-sm font-semibold text-brand-ink">
          {summary}
        </p>
      )}

      {canAct ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={activate}
            disabled={!ready || activating}
            aria-describedby={summary ? helpId : undefined}
            className="flex min-h-[44px] w-full items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {activating ? "Activating..." : "Activate listing"}
          </button>
          {ready && !error && (
            <p className="mt-2 text-xs text-brand-ink-subtle">
              Everything&rsquo;s in. Activating makes this listing public.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-xs text-brand-ink-subtle">
          The owner activates the listing once these are done.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {error}
        </p>
      )}
    </section>
  );
}
