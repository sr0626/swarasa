"use client";

// Left vertical menu for the role consoles. Client component only because the
// active item comes from `usePathname()` -- the shell lives in a layout (or a
// page), which can't know the current path on the server.
//
// Responsive: below `lg` the menu is a horizontally scrollable pill row above
// the panel (scroll is contained in the <nav>, so the page never overflows);
// from `lg` it is a vertical card sticky beside the panel.
//
// Grouping is opt-in: pass `menu` (a ConsoleNavMenu) to get collapsible
// sections / a two-level phone control (ConsoleGroupedNav); otherwise the flat
// `items` list renders exactly as before.
import { usePathname } from "next/navigation";
import ConsoleGroupedNav from "@/components/console/ConsoleGroupedNav";
import ConsoleNavItemRow from "@/components/console/ConsoleNavItemRow";
import { useScrollRow } from "@/components/console/useScrollRow";
import { activeNavHref } from "@/components/console/navItems";
import type { ConsoleNavItem, ConsoleNavMenu } from "@/components/console/navItems";

function FlatNav({ items, label }: { items: ReadonlyArray<ConsoleNavItem>; label: string }) {
  const pathname = usePathname() ?? "";
  const current = activeNavHref(pathname, items);
  const { ref, edges, onScroll } = useScrollRow<HTMLElement>(current ?? "", '[aria-current="page"]');

  return (
    <div className="relative">
      <nav
        ref={ref}
        onScroll={onScroll}
        aria-label={label}
        className="overflow-x-auto py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:overflow-visible lg:rounded-brand-card lg:border lg:border-brand-border lg:bg-white lg:p-2 lg:shadow-brand-card"
      >
        <ul className="flex gap-2 px-1 lg:flex-col lg:gap-1 lg:px-0">
          {items.map((item) => (
            <ConsoleNavItemRow key={item.href} item={item} active={item.href === current} />
          ))}
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

export default function ConsoleSidebarNav({
  items,
  menu,
  label,
}: {
  items: ReadonlyArray<ConsoleNavItem>;
  /** Opt-in grouped menu; when set, `items` is ignored. */
  menu?: ConsoleNavMenu;
  /** Accessible name of the <nav> landmark ("Admin", "Business"). */
  label: string;
}) {
  return menu ? <ConsoleGroupedNav menu={menu} label={label} /> : <FlatNav items={items} label={label} />;
}
