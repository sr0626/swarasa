// Pure view logic for the deal-alerts bell (components/home/DealAlertsBell.tsx).
// No React / Next / sibling-module imports (`.ts` import suffixes only work
// under `node --test`, not `tsc`), so it is unit-tested with `node --test`
// (see view.test.ts). The deals-section path is therefore spelled out here
// and pinned to `locationDealsHref` (lib/restaurant/urls.ts) by a test.
import type { UserNotification } from "@/types/notification";

/** Beyond this the badge reads "99+". */
export const BADGE_MAX = 99;

/** Badge text, or `null` when there is nothing unread (badge hidden). */
export function badgeText(unread: number): string | null {
  if (!Number.isFinite(unread) || unread <= 0) return null;
  return unread > BADGE_MAX ? `${BADGE_MAX}+` : String(Math.floor(unread));
}

/** Accessible name of the bell button -- carries the count (the visual badge is aria-hidden). */
export function bellLabel(unread: number): string {
  if (!Number.isFinite(unread) || unread <= 0) return "Deal alerts, no unread";
  const n = Math.floor(unread);
  return `Deal alerts, ${n} unread`;
}

/** Where a tapped alert goes: the location page, scrolled to its deals section. */
export function notificationHref(n: Pick<UserNotification, "brand_slug" | "location_slug">): string {
  return `/restaurant/${n.brand_slug}/${n.location_slug}#deals`;
}

/** Headline of an alert row. */
export function notificationHeadline(n: Pick<UserNotification, "restaurant_name">): string {
  return `${n.restaurant_name} has a new deal`;
}

export interface BellState {
  items: UserNotification[];
  unread: number;
}

/** Optimistic "this one is read" -- idempotent, never lets unread go negative. */
export function markReadLocally(state: BellState, id: number, nowIso: string): BellState {
  let changed = false;
  const items = state.items.map((n) => {
    if (n.id === id && n.read_at === null) {
      changed = true;
      return { ...n, read_at: nowIso };
    }
    return n;
  });
  if (!changed) return state;
  return { items, unread: Math.max(0, state.unread - 1) };
}

/** Optimistic "everything is read". */
export function markAllReadLocally(state: BellState, nowIso: string): BellState {
  return {
    items: state.items.map((n) => (n.read_at === null ? { ...n, read_at: nowIso } : n)),
    unread: 0,
  };
}

export interface ClickLike {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/**
 * Should the row's click handler take over navigation (mark read, THEN push)?
 * A modified or non-primary click (open in new tab/window) is left to the
 * browser -- the handler still marks the alert read, it just doesn't intercept.
 */
export function shouldInterceptClick(e: ClickLike): boolean {
  if (e.defaultPrevented) return false;
  if (e.button !== 0) return false;
  return !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
}
