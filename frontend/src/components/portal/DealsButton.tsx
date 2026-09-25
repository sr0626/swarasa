// The "Deals" shortcut button on the owner business page location rows and the
// manager "Locations I manage" rows. Its look tells the owner at a glance
// whether a location has deals running (see lib/portal/dealsButton.ts for the
// state -> label mapping):
//   live    tinted accent + "Deals · N"      (>= 1 live deal)
//   empty   quiet outline + "Add a deal"     (none live)
//   hidden  grey dashed + "Deals hidden [· N]" ("Hide all deals" is ON)
// Same 44px box as the neighbouring buttons (BOX mirrors `secondaryLinkClass`);
// only fill/colour and the label differ. Links to the editor's Deals & specials
// section (/deals redirects to it).
import Link from "next/link";
import { TagIcon } from "@/components/ui/icons";
import { dealsButtonState, type DealsButtonVariant } from "@/lib/portal/dealsButton";

const BOX =
  "flex min-h-[44px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-brand-control border px-5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent";

const VARIANT_CLASS: Record<DealsButtonVariant, string> = {
  live: "border-brand-accent/40 bg-brand-accent/10 text-brand-accent hover:bg-brand-accent/15",
  empty:
    "border-brand-border bg-white text-brand-ink-muted hover:border-brand-ink-subtle hover:bg-brand-chip",
  hidden:
    "border-dashed border-brand-ink-subtle/50 bg-brand-bg text-brand-ink-subtle hover:bg-brand-chip",
  neutral:
    "border-brand-border bg-white text-brand-ink hover:border-brand-ink-subtle hover:bg-brand-chip",
};

export default function DealsButton({
  locationId,
  locationLabel,
  activeDealsCount,
  dealsHidden,
}: {
  locationId: number;
  locationLabel: string;
  activeDealsCount: number | null | undefined;
  dealsHidden: boolean | null | undefined;
}) {
  const state = dealsButtonState(locationLabel, activeDealsCount, dealsHidden);
  return (
    <Link
      href={`/portal/locations/${locationId}/deals`}
      aria-label={state.ariaLabel}
      data-deals-state={state.variant}
      className={`${BOX} ${VARIANT_CLASS[state.variant]}`}
    >
      <TagIcon className="h-4 w-4" />
      {state.label}
    </Link>
  );
}
