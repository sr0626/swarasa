// Public restaurant detail page's deals section. Rule (user decision
// 2026-09-25, supersedes the 2026-09-23 registered-user-and-up rule): EVERY
// signed-in session (registered_user, owner of any restaurant, manager,
// admin) sees the full deal cards (title + description); only a SIGNED-OUT
// visitor sees the content-free "Deal(s) available today" sign-in banner.
// There is no content-free pill state for a signed-in viewer.
//
// The content itself is gated server-side: `LocationDetail.deals_today` is
// `null` only for an anonymous caller
// (`deal_service.caller_may_view_deal_content_for_location`,
// backend/app/services/deal_service.py). Banner-vs-cards-vs-nothing is the
// pure `dealsPanelMode` (lib/deals/panel.ts).
import { DEALS_SECTION_ID, dealTypeLabel } from "@/lib/deals/format";
import { dealsPanelMode } from "@/lib/deals/panel";
import DealSignInLink from "@/components/ui/DealSignInLink";
import { TagIcon } from "@/components/ui/icons";
import type { DealPublic } from "@/types/deal";

interface RestaurantDealsProps {
  hasDealToday: boolean;
  /** null = signed-out caller (content withheld); an array = full content. */
  dealsToday: DealPublic[] | null;
  /** Is there a signed-in session? Signed-in viewers always get cards. */
  signedIn: boolean;
  /** This page's path — the sign-in banner returns here after sign-in. */
  signInReturnPath: string;
}

export default function RestaurantDeals({
  hasDealToday,
  dealsToday,
  signedIn,
  signInReturnPath,
}: RestaurantDealsProps) {
  const mode = dealsPanelMode({ hasDealToday, dealsToday, signedIn });
  if (mode === "none") return null;

  if (mode === "sign-in-banner") {
    // Signed-out only: a large, prominent banner that IS the sign-in link.
    // Content-free by design — no title/description.
    return (
      <section id={DEALS_SECTION_ID} aria-label="Deals" className="scroll-mt-24">
        <DealSignInLink currentPath={signInReturnPath} variant="banner" />
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
        {(dealsToday ?? []).map((deal) => (
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
