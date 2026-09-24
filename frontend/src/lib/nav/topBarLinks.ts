// Pure link-set + active-state helpers for the shared top bar
// (components/home/TopBarNav.tsx). No React / Next imports so they can be
// unit-tested with `node --test` (see topBarLinks.test.ts).
//
// Every href below is a route that already exists under src/app. The role
// consoles have their own sidebars (components/console/navItems.ts), so the
// top bar deliberately stays short: the handful of destinations a user of
// that role reaches for most, not a copy of the sidebar.
//
// NOT linked, on purpose: "Report a problem" (only exists per restaurant,
// /restaurant/[brandSlug]/report -- there is no site-wide route) and a per-owner
// "Deals"/"Menu" shortcut (both live under /portal/locations/[id]/..., so
// there is no single target without picking a location).
import type { UserRole } from "@/types/auth";

export interface TopBarLink {
  key: string;
  label: string;
  /** Path, optionally with a query string. Never contains a `#hash`. */
  href: string;
  /**
   * Renders as the header's dark call-to-action pill instead of a plain
   * link ("Add your restaurant", carried over from the previous header).
   */
  cta?: boolean;
}

/** Query param the search page reads for the "Deals today" toggle (lib/search/filters.ts DEALS_TODAY_PARAM). */
const DEALS_TODAY_QUERY = "deals_today=true";

const FIND_RESTAURANTS: TopBarLink = { key: "find", label: "Find restaurants", href: "/search" };
const DEALS_TODAY: TopBarLink = {
  key: "deals",
  label: "Deals today",
  href: `/search?${DEALS_TODAY_QUERY}`,
};

/**
 * Links for a session role; `null` = signed out (or an expired session, which
 * TopBar.tsx already treats as signed out).
 */
export function topBarLinksFor(role: UserRole | null): TopBarLink[] {
  switch (role) {
    case "admin":
      return [
        { key: "overview", label: "Overview", href: "/admin/overview" },
        { key: "claims", label: "Claims", href: "/admin/claims" },
        { key: "reports", label: "Reports", href: "/admin/reports" },
        { key: "listings", label: "Listings", href: "/admin/listings" },
        { key: "owners", label: "Owners", href: "/admin/owners" },
      ];
    case "owner":
      return [
        { key: "mine", label: "My restaurants", href: "/account" },
        FIND_RESTAURANTS,
        { key: "add", label: "Add a restaurant", href: "/portal/brands/new", cta: true },
      ];
    case "manager":
      return [{ key: "mine", label: "My locations", href: "/account" }, FIND_RESTAURANTS];
    case "registered_user":
      return [FIND_RESTAURANTS, DEALS_TODAY, { key: "mine", label: "My favorites", href: "/account" }];
    default:
      return [
        FIND_RESTAURANTS,
        DEALS_TODAY,
        {
          key: "add",
          label: "Add your restaurant",
          // Signed-out: sign in first, then land on the add-restaurant page.
          href: "/login?next=/portal/brands/new",
          cta: true,
        },
      ];
  }
}

/** Minimal shape shared by URLSearchParams and Next's ReadonlyURLSearchParams. */
export interface SearchParamsLike {
  get(name: string): string | null;
}

/**
 * Whether `link` is the current page (drives `aria-current="page"`).
 *  - "Deals today" and "Find restaurants" share the /search path and are told
 *    apart by the `deals_today=true` param, so exactly one of them is active
 *    on /search.
 *  - Other links match their path exactly or as a parent (`/admin/claims` is
 *    active on `/admin/claims/123`); `/account` matches `/account/security`
 *    too, since that page is part of the same account area.
 *  - The signed-out CTA points at /login, which is also where "Sign in" goes;
 *    it is never marked active so the two don't both light up.
 */
export function isTopBarLinkActive(
  link: TopBarLink,
  pathname: string,
  searchParams: SearchParamsLike | null,
): boolean {
  const [path, rawQuery = ""] = link.href.split("?");
  if (path === "/login") return false;

  if (path === "/search") {
    if (pathname !== "/search" && !pathname.startsWith("/search/")) return false;
    const linkWantsDeals = new URLSearchParams(rawQuery).get("deals_today") === "true";
    const onDeals = searchParams?.get("deals_today") === "true";
    return linkWantsDeals === onDeals;
  }

  return pathname === path || pathname.startsWith(`${path}/`);
}
