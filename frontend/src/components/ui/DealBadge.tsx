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

// `variant="overlay"`: the same pill on a solid white background with a soft
// shadow, for sitting over a cover photo (search/home tiles) where the
// default 10%-tint background would be illegible.
export default function DealBadge({
  className = "",
  variant = "inline",
}: {
  className?: string;
  variant?: "inline" | "overlay";
}) {
  const tone =
    variant === "overlay"
      ? "bg-white shadow-brand-card ring-1 ring-brand-accent/20"
      : "bg-brand-accent/10";
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-brand-pill px-2.5 py-1 text-xs font-semibold text-brand-accent ${tone} ${className}`}
    >
      <TagIcon className="h-3.5 w-3.5" />
      Deal(s) available today
    </span>
  );
}
