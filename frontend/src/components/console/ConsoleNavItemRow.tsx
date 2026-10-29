// One menu entry: a pill link below `lg`, a vertical-menu row from `lg`, plus
// (desktop only) the in-page `subItems` anchors while the item is active.
// Shared by the flat menu and the grouped menu so both look identical.
//
// An item can carry an action-item count badge (NavBadgesProvider context,
// keyed by href): shown after the label, with the full accessible name on the
// link ("Claims, 3 pending, 1 overdue"). No provider / no entry -> unchanged.
"use client";

import Link from "next/link";
import NavBadgePill from "@/components/console/NavBadgePill";
import { useNavBadges } from "@/components/console/NavBadgesProvider";
import { NAV_ICONS } from "@/components/console/navIcons";
import type { ConsoleNavItem } from "@/components/console/navItems";

export default function ConsoleNavItemRow({
  item,
  active,
  showSubItems = true,
}: {
  item: ConsoleNavItem;
  active: boolean;
  /** False for the phone pill rows, which never show in-page anchors. */
  showSubItems?: boolean;
}) {
  const { href, label, icon, subItems } = item;
  const Icon = NAV_ICONS[icon];
  const badge = useNavBadges().items[href];
  return (
    <li className="shrink-0 lg:shrink">
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        aria-label={badge?.label}
        className={`flex min-h-[44px] items-center gap-2.5 whitespace-nowrap rounded-brand-pill px-4 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent lg:rounded-brand-control ${
          active
            ? "bg-brand-ink text-brand-bg"
            : "border border-brand-border bg-white text-brand-ink-muted hover:bg-brand-chip hover:text-brand-ink lg:border-transparent"
        }`}
      >
        <Icon className="h-5 w-5 shrink-0" />
        {label}
        {badge && <NavBadgePill badge={badge} className="lg:ml-auto" />}
      </Link>
      {showSubItems && active && subItems && subItems.length > 0 && (
        // In-page section links: desktop only -- below `lg` the menu
        // is a single pill row and the page is short enough to scroll.
        <ul className="mb-1 mt-1 hidden flex-col gap-0.5 border-l border-brand-border pl-3 ml-6 lg:flex">
          {subItems.map((sub) => (
            <li key={sub.href}>
              <Link
                href={sub.href}
                className="flex min-h-[36px] items-center rounded-brand-control px-2 text-sm font-medium text-brand-ink-muted transition hover:bg-brand-chip hover:text-brand-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              >
                {sub.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
