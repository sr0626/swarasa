// "Not live yet" banner + setup checklist on the location editor, shown while a
// listing is in `coming_soon` — i.e. right after "Add restaurant" / "Add
// location" (docs/DECISIONS.md "New manual listings start in setup"). It says
// plainly the listing is NOT public and lists what's still needed with a jump
// link per item. The "Activate listing" button lives in the sticky Go-live bar
// right above (GoLiveBar.tsx), so it is always in view; this is the readable
// checklist.
//
// The list comes from the server (`LocationDetail.setup_missing`); the hours and
// details forms call `router.refresh()` after a save, which re-renders this with
// the new list. Server Component — no state.
import { CheckIcon } from "@/components/ui/icons";
import { isInSetup, setupChecklist } from "@/lib/portal/listingSetup";
import type { LocationStatus } from "@/types/location";

const ANCHOR: Record<"hours" | "info", string> = { hours: "sec-hours", info: "sec-info" };

export default function ListingSetupBanner({
  status,
  setupMissing,
  role,
}: {
  status: LocationStatus;
  setupMissing: string[];
  role: string;
}) {
  if (!isInSetup(status)) return null;

  const items = setupChecklist(setupMissing);
  const canAct = role === "owner" || role === "admin";

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

      <p className="mt-3 text-xs text-brand-ink-subtle">
        {canAct
          ? "When every item is checked, press Activate listing in the bar at the top of the page."
          : "The owner activates the listing once these are done."}
      </p>
    </section>
  );
}
