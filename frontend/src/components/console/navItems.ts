// Menu definitions for the role consoles. Plain serializable data (an icon
// *key*, not a component) so Server Components can hand it to the client-side
// ConsoleSidebarNav. Add a row here when a new page lands in a console.
export type ConsoleNavIcon = "user" | "claims" | "reports" | "store" | "plus" | "clock" | "chart";

/** An in-page anchor link ("/account#profile") shown under an active item. */
export interface ConsoleNavSubItem {
  href: string;
  label: string;
}

export interface ConsoleNavItem {
  href: string;
  label: string;
  icon: ConsoleNavIcon;
  /** In-page section links, rendered under the item while it is active (desktop menu only). */
  subItems?: ReadonlyArray<ConsoleNavSubItem>;
}

export const ADMIN_NAV_ITEMS: ReadonlyArray<ConsoleNavItem> = [
  { href: "/account", label: "Profile", icon: "user" },
  { href: "/admin/overview", label: "Overview", icon: "chart" },
  { href: "/admin/owners", label: "Owners", icon: "user" },
  { href: "/admin/registered-users", label: "Registered users", icon: "user" },
  { href: "/admin/claims", label: "Claims", icon: "claims" },
  // Not named "Reports" -- that label is already taken by the
  // report-a-problem triage queue directly below. This page is called
  // "Platform Overview" / "Overview" everywhere (page title, nav label)
  // specifically to avoid that collision.
  { href: "/admin/reports", label: "Reports", icon: "reports" },
  { href: "/admin/reopen-requests", label: "Reopen requests", icon: "clock" },
  { href: "/admin/listings", label: "Listings", icon: "store" },
];

export const OWNER_NAV_ITEMS: ReadonlyArray<ConsoleNavItem> = [
  {
    href: "/account",
    label: "Business account",
    icon: "store",
    subItems: [
      { href: "/account#restaurants", label: "My restaurants" },
      { href: "/account#profile", label: "Profile" },
      { href: "/account#security", label: "Security" },
      { href: "/account#privacy", label: "Data & privacy" },
    ],
  },
  // Its own page (not an in-page section): the activity feed is only fetched
  // and rendered when this item is selected -- see app/account/activity.
  { href: "/account/activity", label: "Activity", icon: "clock" },
  { href: "/portal/brands/new", label: "Add a restaurant", icon: "plus" },
];

// Three flat items rather than one item with subItems (contrast with
// OWNER_NAV_ITEMS above): a manager's /account is a single short page, so
// top-level links that jump straight to each section read better than a
// submenu under one umbrella label. "My locations" has no hash -- it's
// simply the top of the page, the default view. The `#profile` anchor id
// is the same convention OWNER_NAV_ITEMS already uses for its own
// `/account#profile` link -- keep the id on ManagerAccountView's profile
// section in sync with that href. "Activity" (2026-09-22, its own page since
// 2026-09-24) is the manager activity feed (GET /auth/me/activity broadened
// to serve manager callers) at /account/activity, fetched only on that page.
export const MANAGER_NAV_ITEMS: ReadonlyArray<ConsoleNavItem> = [
  { href: "/account", label: "My locations", icon: "store" },
  { href: "/account/activity", label: "Activity", icon: "clock" },
  { href: "/account#profile", label: "Profile", icon: "user" },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The single active item: the LONGEST matching href, so "/account" (Business
 * account / My locations) is not also highlighted on "/account/activity".
 * Hash-only hrefs ("/account#profile") never match a pathname. */
export function activeNavHref(pathname: string, items: ReadonlyArray<{ href: string }>): string | null {
  let best: string | null = null;
  for (const { href } of items) {
    if (isActive(pathname, href) && (best === null || href.length > best.length)) best = href;
  }
  return best;
}
