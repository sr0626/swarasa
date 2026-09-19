// Admin console frame shared by /account (Profile) and every /admin/* page:
// the generic ConsoleShell with the "Admin console" banner and admin menu.
//
// Used by exactly two callers so nothing is wrapped twice: app/admin/layout.tsx
// (Claims / Reports / Listings) and the admin branch of app/account/page.tsx
// (Profile). The pages inside render only their panel content, never their own
// <main>/TopBar.
import type { ReactNode } from "react";
import ConsoleShell from "@/components/console/ConsoleShell";
import { ADMIN_NAV_ITEMS } from "@/components/console/navItems";
import type { AuthMe } from "@/types/auth";

export default function AdminShell({
  me,
  profile = false,
  children,
}: {
  me: AuthMe;
  /** True on /account, where the admin's name in the banner is the page <h1>. */
  profile?: boolean;
  children: ReactNode;
}) {
  return (
    <ConsoleShell
      me={me}
      bannerLabel="Admin console"
      navLabel="Admin"
      navItems={ADMIN_NAV_ITEMS}
      profile={profile}
    >
      {children}
    </ConsoleShell>
  );
}
