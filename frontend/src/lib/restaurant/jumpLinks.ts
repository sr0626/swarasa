// The jump-link row under the restaurant name on a location page:
// "Deals · Menu · Hours", each ONLY when that section exists for the location
// (so the anchor always lands somewhere). The section ids are set by the
// components that render them: RestaurantDeals / RestaurantUpcomingDeals
// (`deals`), RestaurantMenu (`menu`), the Details card's hours block (`hours`).
// Pure: unit-tested with `node --test`.

export type JumpTarget = "deals" | "menu" | "hours";

export interface JumpLinkItem {
  id: JumpTarget;
  label: string;
  href: string;
}

const LABELS: Record<JumpTarget, string> = { deals: "Deals", menu: "Menu", hours: "Hours" };
const ORDER: JumpTarget[] = ["deals", "menu", "hours"];

export function buildJumpLinks(sections: Record<JumpTarget, boolean>): JumpLinkItem[] {
  return ORDER.filter((id) => sections[id]).map((id) => ({
    id,
    label: LABELS[id],
    href: `#${id}`,
  }));
}

/** Does the location have a deals section for THIS viewer? Today's deals show for everyone
 * (badge/banner/cards); "More deals & specials" is content-gated (null for signed-out viewers). */
export function hasDealsSection(location: {
  has_deal_today: boolean;
  upcoming_deals?: readonly unknown[] | null;
}): boolean {
  return location.has_deal_today || (location.upcoming_deals?.length ?? 0) > 0;
}

/** Does the hours block render? Same rule as RestaurantHours: at least one day with known hours. */
export function hasKnownHours(hours: readonly { is_closed: boolean | null }[]): boolean {
  return hours.some((h) => h.is_closed !== null);
}
