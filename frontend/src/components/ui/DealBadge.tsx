// Content-free "Deal(s) available today" pill — the ONLY deal-related thing
// a signed-out visitor (or any caller without content access) ever sees on
// a search tile or restaurant hero. Deliberately shows no title/description
// (product decision, 2026-09-23: "signed-out/public visitors see ONLY a
// content-free badge — no title/description").
//
// Shared by RestaurantCard.tsx (search results / "Popular near you") and
// RestaurantDeals.tsx (restaurant detail page) so the copy and styling
// can't drift between the two surfaces. Search results never have deal
// CONTENT to show regardless of viewer (docs/API_CONTRACTS.md "GET
// /search" — `NearestLocationOut` only ever carries the boolean
// `has_deal_today`, never `deals_today`), so this is also the only deal UI
// RestaurantCard needs — there is no richer variant to reach for there.
import { TagIcon } from "@/components/ui/icons";

export default function DealBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-brand-pill bg-brand-accent/10 px-2.5 py-1 text-xs font-semibold text-brand-accent ${className}`}
    >
      <TagIcon className="h-3.5 w-3.5" />
      Deal(s) available today
    </span>
  );
}
