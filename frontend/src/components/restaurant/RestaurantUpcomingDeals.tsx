// "More deals & specials" — the location's OTHER active deals (not applicable
// today: other weekdays, or a future start date), shown on the restaurant
// detail page below "Today's deals". Owner feedback 2026-09-23.
//
// Content gating happens entirely server-side: `LocationDetail.upcoming_deals`
// is `null` unless the caller passes
// `deal_service.caller_may_view_deal_content_for_location` (same gate as
// `deals_today`). This component never re-derives viewer identity — a
// null/undefined/empty list renders NOTHING (no heading, no count, no hint
// for signed-out viewers; the sign-in CTA lives in RestaurantDeals).
import { TagIcon } from "@/components/ui/icons";
import { formatDealDays } from "@/lib/deals/format";
import type { DealUpcoming } from "@/types/deal";

const DEAL_TYPE_LABEL: Record<string, string> = {
  deal: "Deal",
  special: "Special",
};

interface RestaurantUpcomingDealsProps {
  upcomingDeals: DealUpcoming[] | null | undefined;
}

export default function RestaurantUpcomingDeals({
  upcomingDeals,
}: RestaurantUpcomingDealsProps) {
  if (!upcomingDeals || upcomingDeals.length === 0) return null;

  return (
    <section
      aria-labelledby="upcoming-deals-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <h2
        id="upcoming-deals-heading"
        className="flex items-center gap-2 font-display text-xl font-bold text-brand-ink"
      >
        <TagIcon className="h-5 w-5 text-brand-ink-subtle" />
        More deals &amp; specials
      </h2>
      <p className="mt-1 text-sm text-brand-ink-muted">
        Not available today — here&apos;s what&apos;s coming up.
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {upcomingDeals.map((deal) => (
          <li
            key={deal.id}
            className="rounded-brand-control border border-brand-border bg-brand-bg p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-brand-pill bg-brand-accent/10 px-2 py-0.5 text-xs font-semibold text-brand-accent">
                {DEAL_TYPE_LABEL[deal.deal_type] ?? deal.deal_type}
              </span>
              <h3 className="min-w-0 break-words font-display text-base font-semibold text-brand-ink">
                {deal.title}
              </h3>
            </div>
            {deal.description && (
              <p className="mt-1.5 whitespace-pre-line break-words text-sm leading-relaxed text-brand-ink-muted">
                {deal.description}
              </p>
            )}
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="font-semibold text-brand-ink">Days</dt>
              <dd className="text-brand-ink-muted">{formatDealDays(deal.applicable_days)}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
