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

// `variant="overlay"`: a solid green pill with white text and a soft shadow,
// for sitting over a cover photo (search/home/favourites tiles). It is
// deliberately NOT the warm red/orange of the tile/cover gradient (the old
// white pill blended in) — green with white text (~5.3:1) stands out on every
// cover. It is NOT a link on tiles: the whole tile is already the link.
export default function DealBadge({
  className = "",
  variant = "inline",
}: {
  className?: string;
  variant?: "inline" | "overlay";
}) {
  const tone =
    variant === "overlay"
      ? "bg-brand-success text-white shadow-brand-card ring-1 ring-white/40"
      : "bg-brand-accent/10 text-brand-accent";
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-brand-pill px-2.5 py-1 text-xs font-semibold ${tone} ${className}`}
    >
      <TagIcon className="h-3.5 w-3.5" />
      Deal(s) available today
    </span>
  );
}
