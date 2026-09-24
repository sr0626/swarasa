"use client";

// Left vertical menu for the role consoles. Client component only because the
// active item comes from `usePathname()` -- the shell lives in a layout (or a
// page), which can't know the current path on the server.
//
// Responsive: below `lg` the menu is a horizontally scrollable pill row above
// the panel (scroll is contained in the <nav>, so the page never overflows);
// from `lg` it is a vertical card sticky beside the panel.
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChartIcon,
  ClipboardCheckIcon,
  ClockIcon,
  FlagIcon,
  PlusIcon,
  StoreIcon,
  UserIcon,
} from "@/components/ui/icons";
import type { IconProps } from "@/components/ui/icons";
import { activeNavHref } from "@/components/console/navItems";
import type { ConsoleNavIcon, ConsoleNavItem } from "@/components/console/navItems";

const ICONS: Record<ConsoleNavIcon, (props: IconProps) => JSX.Element> = {
  user: UserIcon,
  claims: ClipboardCheckIcon,
  reports: FlagIcon,
  store: StoreIcon,
  plus: PlusIcon,
  clock: ClockIcon,
  chart: BarChartIcon,
};

export default function ConsoleSidebarNav({
  items,
  label,
}: {
  items: ReadonlyArray<ConsoleNavItem>;
  /** Accessible name of the <nav> landmark ("Admin", "Business"). */
  label: string;
}) {
  const pathname = usePathname() ?? "";
  const current = activeNavHref(pathname, items);
  return (
    <nav
      aria-label={label}
      className="overflow-x-auto py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:overflow-visible lg:rounded-brand-card lg:border lg:border-brand-border lg:bg-white lg:p-2 lg:shadow-brand-card"
    >
      <ul className="flex gap-2 px-1 lg:flex-col lg:gap-1 lg:px-0">
        {items.map(({ href, label: itemLabel, icon, subItems }) => {
          const active = href === current;
          const Icon = ICONS[icon];
          return (
            <li key={href} className="shrink-0 lg:shrink">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[44px] items-center gap-2.5 whitespace-nowrap rounded-brand-pill px-4 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent lg:rounded-brand-control ${
                  active
                    ? "bg-brand-ink text-brand-bg"
                    : "border border-brand-border bg-white text-brand-ink-muted hover:bg-brand-chip hover:text-brand-ink lg:border-transparent"
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {itemLabel}
              </Link>
              {active && subItems && subItems.length > 0 && (
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
        })}
      </ul>
    </nav>
  );
}
