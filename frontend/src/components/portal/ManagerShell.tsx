// Manager console frame: the generic ConsoleShell with a "Manager" banner
// (no "Business account" wording -- managers don't own the business, they
// work assigned locations) and the manager menu (My locations / Profile).
// Used by the manager branch of /account -- the manager's only console page
// today; a future manager-scoped section (if one lands) can reuse this the
// same way /portal/brands/* reuses OwnerShell.
import type { ReactNode } from "react";
import ConsoleShell from "@/components/console/ConsoleShell";
import { MANAGER_NAV_ITEMS } from "@/components/console/navItems";
import type { AuthMe } from "@/types/auth";

export default function ManagerShell({
  me,
  profile = false,
  children,
}: {
  me: AuthMe;
  /** True on /account, where the manager's name in the banner is the page <h1>. */
  profile?: boolean;
  children: ReactNode;
}) {
  return (
    <ConsoleShell
      me={me}
      bannerLabel="Manager"
      navLabel="Manager"
      navItems={MANAGER_NAV_ITEMS}
      profile={profile}
    >
      {children}
    </ConsoleShell>
  );
}
