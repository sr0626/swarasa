// Owner console frame: the generic ConsoleShell with the owner menu (Business account with in-page links / Add a
// restaurant). Used by the owner branch of /account (the single business
// page) and /portal/brands/* (via its layout). See
// components/portal/ManagerShell.tsx for the manager's equivalent, which
// reuses the same ConsoleShell with its own menu.
import type { ReactNode } from "react";
import ConsoleShell from "@/components/console/ConsoleShell";
import { OWNER_NAV_ITEMS } from "@/components/console/navItems";

export default function OwnerShell({
  profile = false,
  children,
}: {
  /** True on /account, which needs a screen-reader <h1>. */
  profile?: boolean;
  children: ReactNode;
}) {
  return (
    <ConsoleShell
      navLabel="Business"
      navItems={OWNER_NAV_ITEMS}
      profile={profile}
    >
      {children}
    </ConsoleShell>
  );
}
