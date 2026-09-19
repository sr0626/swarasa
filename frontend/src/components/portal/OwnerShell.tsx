// Owner console frame: the generic ConsoleShell with the "Business account"
// banner and the owner menu (My restaurants / Add a restaurant / Profile &
// account). Used by /portal/dashboard (owner branch), /portal/brands/* (via
// its layout) and the owner branch of /account. Managers are not given this
// shell yet -- a ManagerShell can reuse ConsoleShell with its own menu.
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
