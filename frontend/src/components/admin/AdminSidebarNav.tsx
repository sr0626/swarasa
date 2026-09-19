"use client";

// Left vertical menu for the admin console. Client component only because the
// active item comes from `usePathname()` -- the shell lives in a layout (and
// on /account), which can't know the current path on the server.
//
// Add a row to ADMIN_NAV_ITEMS when a new admin page lands (e.g. the
// data-deletion review queue).
//
// Responsive: below `lg` the menu is a horizontally scrollable pill row above
// the panel (scroll is contained in the <nav>, so the page never overflows);
// from `lg` it is a vertical card sticky beside the panel.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheckIcon, FlagIcon, StoreIcon, UserIcon } from "@/components/ui/icons";
import type { IconProps } from "@/components/ui/icons";

interface AdminNavItem {
  href: string;
  label: string;
  Icon: (props: IconProps) => JSX.Element;
}

const ADMIN_NAV_ITEMS: ReadonlyArray<AdminNavItem> = [
  { href: "/account", label: "Profile", Icon: UserIcon },
  { href: "/admin/claims", label: "Claims", Icon: ClipboardCheckIcon },
  { href: "/admin/reports", label: "Reports", Icon: FlagIcon },
  { href: "/admin/listings", label: "Listings", Icon: StoreIcon },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminSidebarNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav
      aria-label="Admin"
      className="overflow-x-auto py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:overflow-visible lg:rounded-brand-card lg:border lg:border-brand-border lg:bg-white lg:p-2 lg:shadow-brand-card"
    >
      <ul className="flex gap-2 px-1 lg:flex-col lg:gap-1 lg:px-0">
        {ADMIN_NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
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
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
