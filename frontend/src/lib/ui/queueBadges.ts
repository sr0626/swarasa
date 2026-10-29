// Pure logic for the admin "Work queue" action-item badges: turning the
// GET /admin/queue-counts payload into per-item and per-group badges (visible
// text, accessible label, urgency). No React / DOM here so it is unit-testable
// (queueBadges.test.ts). Everything tolerates missing / partial / malformed
// counts: an unusable value is treated as 0, and 0 never renders a badge.

/** Largest number shown literally; anything above renders as "99+". */
export const BADGE_CAP = 99;

/** One badge as the menu renders it. */
export interface NavBadge {
  /** Visible text: "12", or "99+". Never empty. */
  text: string;
  /** Accessible name of the whole control it sits on ("Claims, 3 pending, 1 overdue"). */
  label: string;
  /** True for the stronger warning style (overdue claims). */
  urgent: boolean;
}

/** Badges keyed by nav item `href` and by group `id`. */
export interface NavBadges {
  items: Record<string, NavBadge>;
  groups: Record<string, NavBadge>;
}

export const EMPTY_NAV_BADGES: NavBadges = { items: {}, groups: {} };

/** Normalised counts (every field a non-negative integer). */
export interface QueueCounts {
  claimsPending: number;
  claimsOverdue: number;
  messagesOpen: number;
  reportsNew: number;
  reopenPending: number;
  total: number;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function obj(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Reads the API payload defensively. Returns null when it is not an object at
 * all; otherwise any missing / non-numeric field counts as 0. `total` is
 * re-derived from the four queues (never trusted from the payload), and
 * `overdue` is clamped to `pending` since it is a subset of it.
 */
export function normalizeQueueCounts(raw: unknown): QueueCounts | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const claimsPending = count(obj(r.claims).pending);
  const claimsOverdue = Math.min(count(obj(r.claims).overdue), claimsPending);
  const messagesOpen = count(obj(r.messages).open);
  const reportsNew = count(obj(r.reports).new);
  const reopenPending = count(obj(r.reopen_requests).pending);
  return {
    claimsPending,
    claimsOverdue,
    messagesOpen,
    reportsNew,
    reopenPending,
    total: claimsPending + messagesOpen + reportsNew + reopenPending,
  };
}

/** Visible badge text: null for 0 (no badge), the number up to 99, else "99+". */
export function badgeText(n: number): string | null {
  const v = count(n);
  if (v === 0) return null;
  return v > BADGE_CAP ? `${BADGE_CAP}+` : String(v);
}

/** Accessible name for a queue item: "Claims, 3 pending, 1 overdue". */
export function itemAriaLabel(label: string, n: number, noun: string, overdue = 0): string {
  const parts = [`${label}, ${count(n)} ${noun}`];
  if (count(overdue) > 0) parts.push(`${count(overdue)} overdue`);
  return parts.join(", ");
}

/** Accessible name for the group: "Work queue, 5 need action" (1 -> "1 needs action"). */
export function groupAriaLabel(title: string, total: number): string {
  const n = count(total);
  return `${title}, ${n} ${n === 1 ? "needs" : "need"} action`;
}

function itemBadge(label: string, n: number, noun: string, overdue = 0): NavBadge | null {
  const text = badgeText(n);
  if (text === null) return null;
  return { text, label: itemAriaLabel(label, n, noun, overdue), urgent: count(overdue) > 0 };
}

/** Admin queue pages, keyed by nav href -> label + the word used for "waiting". */
const ITEM_HREFS = {
  claims: "/admin/claims",
  messages: "/admin/messages",
  reports: "/admin/reports",
  reopen: "/admin/reopen-requests",
} as const;

/** The nav group id (navItems.ts ADMIN_NAV_MENU) that holds the four queues. */
export const WORK_QUEUE_GROUP_ID = "work-queue";
const WORK_QUEUE_TITLE = "Work queue";

/**
 * Badges for the admin menu. Empty (no badges at all) when `counts` is null or
 * every queue is empty -- no "all clear" noise. The group badge carries the
 * total and is `urgent` when any claim is overdue.
 */
export function buildAdminNavBadges(counts: QueueCounts | null): NavBadges {
  if (counts === null || counts.total === 0) return EMPTY_NAV_BADGES;
  const items: Record<string, NavBadge> = {};
  const put = (href: string, badge: NavBadge | null): void => {
    if (badge) items[href] = badge;
  };
  put(ITEM_HREFS.claims, itemBadge("Claims", counts.claimsPending, "pending", counts.claimsOverdue));
  put(ITEM_HREFS.messages, itemBadge("Messages", counts.messagesOpen, "open"));
  put(ITEM_HREFS.reports, itemBadge("Reports", counts.reportsNew, "new"));
  put(ITEM_HREFS.reopen, itemBadge("Reopen requests", counts.reopenPending, "pending"));

  const text = badgeText(counts.total);
  const groups: Record<string, NavBadge> = text
    ? {
        [WORK_QUEUE_GROUP_ID]: {
          text,
          label: groupAriaLabel(WORK_QUEUE_TITLE, counts.total),
          urgent: counts.claimsOverdue > 0,
        },
      }
    : {};
  return { items, groups };
}

/**
 * Accessible name for a group control (header / phone pill): the group's own
 * badge label when it has one, else undefined (leave the visible text to name it).
 * `current` appends the existing "current section" hint so a badge does not
 * hide it.
 */
export function groupControlLabel(badge: NavBadge | undefined, current: boolean): string | undefined {
  if (!badge) return undefined;
  return current ? `${badge.label}, current section` : badge.label;
}
