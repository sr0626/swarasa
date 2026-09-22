// Owner console frame: the generic ConsoleShell with the "Business account"
// banner and the owner menu (Business account with in-page links / Add a
// restaurant). Used by the owner branch of /account (the single business
// page) and /portal/brands/* (via its layout). See
// components/portal/ManagerShell.tsx for the manager's equivalent, which
// reuses the same ConsoleShell with its own banner label and menu.
import type { ReactNode } from "react";
import ConsoleShell from "@/components/console/ConsoleShell";
import { OWNER_NAV_ITEMS } from "@/components/console/navItems";
import type { AuthMe } from "@/types/auth";

export default function OwnerShell({
  me,
  profile = false,
  children,
}: {
  me: AuthMe;
  /** True on /account, where the owner's name in the banner is the page <h1>. */
  profile?: boolean;
  children: ReactNode;
}) {
  return (
    <ConsoleShell
      me={me}
      bannerLabel="Business account"
      navLabel="Business"
      navItems={OWNER_NAV_ITEMS}
      profile={profile}
    >
      {children}
    </ConsoleShell>
  );
}
