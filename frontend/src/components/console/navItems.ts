// Menu definitions for the role consoles. Plain serializable data (an icon
// *key*, not a component) so Server Components can hand it to the client-side
// ConsoleSidebarNav. Add a row here when a new page lands in a console.
export type ConsoleNavIcon = "user" | "claims" | "reports" | "store" | "plus";

export interface ConsoleNavItem {
  href: string;
  label: string;
  icon: ConsoleNavIcon;
}

export const ADMIN_NAV_ITEMS: ReadonlyArray<ConsoleNavItem> = [
  { href: "/account", label: "Profile", icon: "user" },
  { href: "/admin/claims", label: "Claims", icon: "claims" },
  { href: "/admin/reports", label: "Reports", icon: "reports" },
  { href: "/admin/listings", label: "Listings", icon: "store" },
];

export const OWNER_NAV_ITEMS: ReadonlyArray<ConsoleNavItem> = [
  { href: "/portal/dashboard", label: "My restaurants", icon: "store" },
  { href: "/portal/brands/new", label: "Add a restaurant", icon: "plus" },
  { href: "/account", label: "Profile & account", icon: "user" },
];
