// Menu definitions for the role consoles. Plain serializable data (an icon
// *key*, not a component) so Server Components can hand it to the client-side
// ConsoleSidebarNav. Add a row here when a new page lands in a console.
export type ConsoleNavIcon = "user" | "claims" | "reports" | "store" | "plus";

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
  { href: "/admin/claims", label: "Claims", icon: "claims" },
  { href: "/admin/reports", label: "Reports", icon: "reports" },
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
  { href: "/portal/brands/new", label: "Add a restaurant", icon: "plus" },
];

// Two flat items rather than one item with subItems (contrast with
// OWNER_NAV_ITEMS above): a manager's /account is a single short page with
// exactly two sections, so a top-level "Profile" link that jumps straight to
// `#profile` reads better than a submenu under one umbrella label. "My
// locations" has no hash -- it's simply the top of the page, the default
// view. The `#profile` anchor id is the same convention OWNER_NAV_ITEMS
// already uses for its own `/account#profile` link -- keep the id on
// ManagerAccountView's profile section in sync with this href.
export const MANAGER_NAV_ITEMS: ReadonlyArray<ConsoleNavItem> = [
  { href: "/account", label: "My locations", icon: "store" },
  { href: "/account#profile", label: "Profile", icon: "user" },
];
