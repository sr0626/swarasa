// Shown at the top of the public restaurant page ONLY to someone who can
// edit this listing (admin, the owning owner, or an assigned manager -- the
// check lives in lib/restaurant/profileData.ts `canEditListing`). Links to the existing
// location editor rather than turning the public page into an editor, so the
// public page stays fast, cacheable-in-spirit and SEO-clean for everyone else.
//
// Second line (added for the owner/manager "preview registered-user view"
// annotation layer -- see RestaurantHero's `ownerPreview` prop): this same
// gate (`canEditListing`) is the only viewer this page ever shows a
// diner-only-content preview to, so the explanation belongs right here next
// to "You can edit this listing," not as a separate banner. Deliberately
// short -- this is a helper annotation, not a redesign of the bar.
import Link from "next/link";
import { PencilIcon } from "@/components/ui/icons";

export default function EditListingBar({ locationId }: { locationId: number }) {
  return (
    <div className="mb-5 flex flex-col items-start gap-3 rounded-brand-card border border-brand-border bg-brand-chip p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-brand-chip-ink">
        You can edit this listing. You&apos;re viewing the same page a diner
        sees -- elements only diners get (like following) are marked below.
      </p>
      <Link
        href={`/portal/locations/${locationId}`}
        className="flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-brand-pill bg-brand-ink px-5 text-sm font-semibold text-brand-bg transition hover:bg-brand-ink/90"
      >
        <PencilIcon className="h-4 w-4" />
        Edit listing
      </Link>
    </div>
  );
}
