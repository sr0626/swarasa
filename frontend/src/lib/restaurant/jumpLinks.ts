// The jump-link row under the restaurant name on a location page:
// "Menu · Hours", each ONLY when that section exists for the location
// (so the anchor always lands somewhere) and ONLY when there are at least two
// (a row with a single pill is pointless — e.g. a lone "Hours" chip under the
// name when the location has no deals and no menu; product feedback
// 2026-09-25). The section ids are set by the
// components that render them: RestaurantMenu (`menu`), the Details card's
// hours block (`hours`). Deals is deliberately NOT a jump target (product
// feedback 2026-09-25): the deals section / sign-in banner sits directly under
// the restaurant name, so a "Deals" pill would jump to where the reader already is.
// Pure: unit-tested with `node --test`.

export type JumpTarget = "menu" | "hours";

export interface JumpLinkItem {
  id: JumpTarget;
  label: string;
  href: string;
}

const LABELS: Record<JumpTarget, string> = { menu: "Menu", hours: "Hours" };
const ORDER: JumpTarget[] = ["menu", "hours"];

/** Minimum number of sections before the jump row is worth showing at all. */
export const MIN_JUMP_LINKS = 2;

export function buildJumpLinks(sections: Record<JumpTarget, boolean>): JumpLinkItem[] {
  const links = ORDER.filter((id) => sections[id]).map((id) => ({
    id,
    label: LABELS[id],
    href: `#${id}`,
  }));
  return links.length >= MIN_JUMP_LINKS ? links : [];
}

/** Does the hours block render? Same rule as RestaurantHours: at least one day with known hours. */
export function hasKnownHours(hours: readonly { is_closed: boolean | null }[]): boolean {
  return hours.some((h) => h.is_closed !== null);
}
