// Public restaurant detail page's deals section — task requirement
// (2026-09-23): "Deal(s) available today" badge for the public
// (content-free), full deal cards (title + description) for a signed-in
// registered_user and up (and the location's own owner/manager/admin).
//
// Content gating happens entirely server-side, before this component ever
// renders: `LocationDetail.deals_today` is `null` unless the caller passes
// `deal_service.caller_may_view_deal_content_for_location`
// (backend/app/services/deal_service.py) — this component only branches on
// whether that array is present, it never re-derives viewer identity
// itself (see the restaurant page routes for where the access token is
// attached to the `getLocationById` call that produces this data).
import { DEALS_SECTION_ID, dealTypeLabel } from "@/lib/deals/format";
import DealBadge from "@/components/ui/DealBadge";
import DealSignInLink from "@/components/ui/DealSignInLink";
import { TagIcon } from "@/components/ui/icons";
import type { DealPublic } from "@/types/deal";

interface RestaurantDealsProps {
  hasDealToday: boolean;
  /** null = content-gated for this viewer (still show the content-free
   * badge, per `hasDealToday`); a real (non-empty, in practice) array =
   * full content. */
  dealsToday: DealPublic[] | null;
  /** This page's path, passed ONLY for a signed-out visitor — turns the
   * "Deal(s) available today" pane into a large sign-in banner that returns
   * here after sign-in. Omitted for every signed-in role, whose UI is
   * unchanged (plain badge). */
  signInReturnPath?: string;
}

export default function RestaurantDeals({
  hasDealToday,
  dealsToday,
  signInReturnPath,
}: RestaurantDealsProps) {
  if (!hasDealToday) return null;

  if (!dealsToday || dealsToday.length === 0) {
    // Content-gated for this viewer (signed-out, or signed in with no
    // relationship to this location) — content-free by design, no
    // title/description, no explanation of why (that would itself hint at
    // there being more to see for some viewers and not others).
    return (
      <section id={DEALS_SECTION_ID} aria-label="Deals" className="scroll-mt-24">
        {signInReturnPath ? (
          // Signed-out: a large, prominent banner that IS the sign-in link.
          <DealSignInLink currentPath={signInReturnPath} variant="banner" />
        ) : (
          <DealBadge />
        )}
      </section>
    );
  }

  return (
    <section
      id={DEALS_SECTION_ID}
      aria-labelledby="deals-heading"
      className="scroll-mt-24 rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <h2
        id="deals-heading"
        className="flex items-center gap-2 font-display text-xl font-bold text-brand-ink"
      >
        <TagIcon className="h-5 w-5 text-brand-ink-subtle" />
        Today&apos;s deals
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {dealsToday.map((deal) => (
          <li
            key={deal.id}
            className="rounded-brand-control border border-brand-border bg-brand-bg p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-brand-pill bg-brand-accent/10 px-2 py-0.5 text-xs font-semibold text-brand-accent">
                {dealTypeLabel(deal.deal_type)}
              </span>
              <h3 className="font-display text-base font-semibold text-brand-ink">{deal.title}</h3>
            </div>
            {deal.description && (
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-brand-ink-muted">
                {deal.description}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
