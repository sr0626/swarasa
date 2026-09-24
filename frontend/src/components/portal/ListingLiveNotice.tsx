// "Your listing is live" confirmation on the location editor, shown once right
// after the owner activates a listing (ActivateListingButton replaces the URL
// with `?live=1`). Links to the listing's own public page. Server-renderable —
// no state; it goes away on the next navigation.
import Link from "next/link";
import { CheckIcon } from "@/components/ui/icons";
import { locationHref } from "@/lib/restaurant/urls";

export function parseLiveParam(value: string | string[] | undefined): boolean {
  return (Array.isArray(value) ? value[0] : value) === "1";
}

export default function ListingLiveNotice({
  brandSlug,
  locationSlug,
}: {
  brandSlug: string;
  locationSlug: string;
}) {
  return (
    <div
      role="status"
      data-testid="listing-live-notice"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-brand-card border border-brand-success/40 bg-brand-success-bg px-4 py-3 sm:px-5"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-brand-success sm:text-base">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-success text-white"
        >
          <CheckIcon className="h-3.5 w-3.5" />
        </span>
        Your listing is live
      </p>
      <Link
        href={locationHref(brandSlug, locationSlug)}
        className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-success px-5 text-sm font-semibold text-white transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-success focus-visible:ring-offset-2"
      >
        View public page
      </Link>
    </div>
  );
}
