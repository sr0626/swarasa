// Which deals treatment the restaurant page shows for THIS viewer. Pure so the
// rule is unit-testable (the component only renders what this decides).
//
// Rule (user decision 2026-09-25): deal CONTENT is visible to every signed-in
// account of any role; only a SIGNED-OUT visitor gets the content-free
// signal, and it is the sign-in banner. There is no in-between "content-free
// pill for a signed-in viewer" state any more.
import type { DealPublic } from "@/types/deal";

export type DealsPanelMode =
  /** Nothing to show (no deal today, or a signed-in viewer with no list). */
  | "none"
  /** Signed-out visitor + a deal today: the content-free sign-in banner. */
  | "sign-in-banner"
  /** Signed-in viewer with content: the full deal cards. */
  | "cards";

export function dealsPanelMode(args: {
  hasDealToday: boolean;
  /** `LocationDetail.deals_today` — null for a signed-out caller. */
  dealsToday: readonly DealPublic[] | null | undefined;
  signedIn: boolean;
}): DealsPanelMode {
  if (!args.hasDealToday) return "none";
  if (!args.signedIn) return "sign-in-banner";
  return (args.dealsToday?.length ?? 0) > 0 ? "cards" : "none";
}
