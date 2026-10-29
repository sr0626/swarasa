// Menu definitions for the role consoles. Plain serializable data (an icon
// *key*, not a component) so Server Components can hand it to the client-side
// ConsoleSidebarNav. Add a row here when a new page lands in a console.
export type ConsoleNavIcon = "user" | "claims" | "reports" | "store" | "plus" | "clock" | "chart" | "mail" | "tag";

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

/** The owner/manager "Contact admin" form page. */
export const CONTACT_ADMIN_HREF = "/portal/contact-admin";

/** A titled, collapsible section of a console menu. */
export interface ConsoleNavGroup {
  /** Stable key (also part of the localStorage state), never shown. */
  id: string;
  title: string;
  items: ReadonlyArray<ConsoleNavItem>;
  /** Open on a first visit (the group holding the active page is always open). */
  defaultOpen?: boolean;
}

/**
 * A grouped console menu: standalone `top` items (always visible), then
 * collapsible `groups`. Opt-in -- a console passes this to ConsoleShell as
 * `navMenu`; consoles that don't keep rendering their flat item list.
 */
export interface ConsoleNavMenu {
  top: ReadonlyArray<ConsoleNavItem>;
  groups: ReadonlyArray<ConsoleNavGroup>;
}

/** The menu's items as one flat list: top items, then each group's items in order. */
export function flattenNavMenu(menu: ConsoleNavMenu): ReadonlyArray<ConsoleNavItem> {
  return [...menu.top, ...menu.groups.flatMap((g) => g.items)];
}

// Admin menu order (user decision 2026-10-28): the dashboard on top, then
// Listings (open by default), People (users), the Work queue (claims have a 72h
// SLA, messages and problem reports need a reply), and System (audit history +
// the admin's own profile). Single source of truth for the admin menu:
// ADMIN_NAV_ITEMS below is derived from it.
export const ADMIN_NAV_MENU: ConsoleNavMenu = {
  top: [{ href: "/admin/overview", label: "Overview", icon: "chart" }],
  groups: [
    {
      id: "listings",
      title: "Listings",
      defaultOpen: true,
      items: [
        { href: "/admin/listings", label: "Listings", icon: "store" },
        // Bulk CSV import of unclaimed listings (POST /admin/import/validate + /commit).
        { href: "/admin/import", label: "Import", icon: "plus" },
        // Cuisine / dietary / restaurant-type tags (GET/POST/PATCH /admin/taxonomy).
        { href: "/admin/taxonomy", label: "Taxonomy", icon: "tag" },
      ],
    },
    {
      id: "people",
      title: "People",
      items: [
        // Every account across all roles, with disable/confirm/reset actions.
        { href: "/admin/users", label: "Users", icon: "user" },
        { href: "/admin/owners", label: "Owners", icon: "user" },
        { href: "/admin/managers", label: "Managers", icon: "user" },
        { href: "/admin/registered-users", label: "Registered users", icon: "user" },
      ],
    },
    {
      id: "work-queue",
      title: "Work queue",
      items: [
        { href: "/admin/claims", label: "Claims", icon: "claims" },
        // "Contact admin" messages from owners/managers (GET /admin/messages).
        { href: "/admin/messages", label: "Messages", icon: "mail" },
        // The report-a-problem triage queue. The dashboard is called
        // "Overview" (not "Reports") to avoid colliding with this label.
        { href: "/admin/reports", label: "Reports", icon: "reports" },
        { href: "/admin/reopen-requests", label: "Reopen requests", icon: "clock" },
      ],
    },
    {
      id: "system",
      title: "System",
      items: [
        // Read-only history of audit_log (GET /admin/audit-log).
        { href: "/admin/audit-log", label: "Audit log", icon: "clock" },
        { href: "/account", label: "Profile", icon: "user" },
      ],
    },
  ],
};

export const ADMIN_NAV_GROUPS: ReadonlyArray<ConsoleNavGroup> = ADMIN_NAV_MENU.groups;

/** The admin menu as a flat list (same order as the grouped menu). */
export const ADMIN_NAV_ITEMS: ReadonlyArray<ConsoleNavItem> = flattenNavMenu(ADMIN_NAV_MENU);

export const OWNER_NAV_ITEMS: ReadonlyArray<ConsoleNavItem> = [
  {
    href: "/account",
    label: "Business account",
    icon: "store",
    subItems: [
      { href: "/account#restaurants", label: "My restaurants" },
      { href: "/account#profile", label: "Profile" },
      { href: "/account#security", label: "Security" },
    ],
  },
  // Its own page (not an in-page section): the activity feed is only fetched
  // and rendered when this item is selected -- see app/account/activity.
  { href: "/account/activity", label: "Activity", icon: "clock" },
  { href: "/portal/brands/new", label: "Add a restaurant", icon: "plus" },
  // Write to the platform admins (POST /contact-admin) -- /portal/contact-admin.
  { href: CONTACT_ADMIN_HREF, label: "Contact admin", icon: "mail" },
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
  { href: CONTACT_ADMIN_HREF, label: "Contact admin", icon: "mail" },
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

/** The group whose item is the active page for `pathname`, or null (a top item, or no match). */
export function groupForPath(
  pathname: string,
  groups: ReadonlyArray<ConsoleNavGroup> = ADMIN_NAV_GROUPS
): ConsoleNavGroup | null {
  const current = activeNavHref(
    pathname,
    groups.flatMap((g) => g.items)
  );
  if (current === null) return null;
  return groups.find((g) => g.items.some((i) => i.href === current)) ?? null;
}
