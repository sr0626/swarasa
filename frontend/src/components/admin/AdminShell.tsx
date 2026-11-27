// Admin console frame shared by /account (Profile) and every /admin/* page:
// the generic ConsoleShell with the admin menu.
//
// Used by exactly two callers so nothing is wrapped twice: app/admin/layout.tsx
// (Claims / Reports / Listings) and the admin branch of app/account/page.tsx
// (Profile). The pages inside render only their panel content, never their own
// <main>/TopBar.
import type { ReactNode } from "react";
import ConsoleShell from "@/components/console/ConsoleShell";
import NavBadgesProvider from "@/components/console/NavBadgesProvider";
import { ADMIN_NAV_ITEMS, ADMIN_NAV_MENU } from "@/components/console/navItems";
import { refreshAdminNavBadgesAction } from "@/lib/actions/adminQueueCounts";
import type { NavBadges } from "@/lib/ui/queueBadges";

export default function AdminShell({
  profile = false,
  navBadges = null,
  children,
}: {
  /**
   * Work queue action-item badges (loadAdminNavBadges), fetched once per page
   * render by the caller; null = unavailable, menu renders without badges.
   */
  navBadges?: NavBadges | null;
  /** True on /account, which needs a screen-reader <h1>. */
  profile?: boolean;
  children: ReactNode;
}) {
  return (
    <NavBadgesProvider initial={navBadges} refresh={refreshAdminNavBadgesAction}>
      <ConsoleShell
        navLabel="Admin"
        navItems={ADMIN_NAV_ITEMS}
        navMenu={ADMIN_NAV_MENU}
        profile={profile}
      >
        {children}
      </ConsoleShell>
    </NavBadgesProvider>
  );
}
