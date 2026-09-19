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
