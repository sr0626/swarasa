// Manager console frame: the generic ConsoleShell with the manager menu (My locations / Profile).
// Used by the manager branch of /account -- the manager's only console page
// today; a future manager-scoped section (if one lands) can reuse this the
// same way /portal/brands/* reuses OwnerShell.
import type { ReactNode } from "react";
import ConsoleShell from "@/components/console/ConsoleShell";
import { MANAGER_NAV_ITEMS } from "@/components/console/navItems";

export default function ManagerShell({
  profile = false,
  children,
}: {
  /** True on /account, which needs a screen-reader <h1>. */
  profile?: boolean;
  children: ReactNode;
}) {
  return (
    <ConsoleShell
      navLabel="Manager"
      navItems={MANAGER_NAV_ITEMS}
      profile={profile}
    >
      {children}
    </ConsoleShell>
  );
}
