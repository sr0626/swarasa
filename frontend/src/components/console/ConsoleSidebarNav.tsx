"use client";

// Left vertical menu for the role consoles. Client component only because the
// active item comes from `usePathname()` -- the shell lives in a layout (or a
// page), which can't know the current path on the server.
//
// Responsive: below `lg` the menu is a horizontally scrollable pill row above
// the panel (scroll is contained in the <nav>, so the page never overflows);
// from `lg` it is a vertical card sticky beside the panel.
import { useCallback, useEffect, useRef, useState } from "react";
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
import { centerScrollLeft, scrollEdges, type ScrollEdges } from "@/lib/ui/horizontalScroll";

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
  const navRef = useRef<HTMLElement>(null);
  const firstRunRef = useRef(true);
  const [edges, setEdges] = useState<ScrollEdges>({ left: false, right: false });

  const measureEdges = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const next = scrollEdges(nav.scrollLeft, nav.clientWidth, nav.scrollWidth);
    setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);

  // Below `lg` the menu is a horizontal scroller: bring the selected pill into
  // view (instantly on first paint, smoothly on later route changes unless the
  // user prefers reduced motion) and keep the edge fades in step with scrolling.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (active && nav.scrollWidth > nav.clientWidth) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      nav.scrollTo({
        left: centerScrollLeft(active.offsetLeft, active.offsetWidth, nav.clientWidth, nav.scrollWidth),
        behavior: firstRunRef.current || reduce ? "auto" : "smooth",
      });
    }
    firstRunRef.current = false;
    measureEdges();
    window.addEventListener("resize", measureEdges);
    return () => window.removeEventListener("resize", measureEdges);
  }, [current, measureEdges]);

  return (
    <div className="relative">
      <nav
        ref={navRef}
        onScroll={measureEdges}
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
    {/* Edge fades: tell a phone user the pill row scrolls (only while there is
        more to reveal on that side; decorative, never intercepts touches). */}
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-brand-bg to-transparent transition-opacity lg:hidden ${
        edges.left ? "opacity-100" : "opacity-0"
      }`}
    />
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-brand-bg to-transparent transition-opacity lg:hidden ${
        edges.right ? "opacity-100" : "opacity-0"
      }`}
    />
    </div>
  );
}
