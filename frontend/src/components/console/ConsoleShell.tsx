// Role-console frame: page background, TopBar, then a left vertical menu with
// the selected section's content in the right-hand panel. AdminShell, OwnerShell
// and ManagerShell are thin wrappers that supply the menu items. Pages inside
// render only their panel content, never their own <main>/TopBar.
//
// There is deliberately no identity banner (removed at the user's request
// 2026-11-26: it took too much room); the account menu in the TopBar already
// names the signed-in user.
import type { ReactNode } from "react";
import TopBar from "@/components/home/TopBar";
import ConsoleSidebarNav from "@/components/console/ConsoleSidebarNav";
import type { ConsoleNavItem, ConsoleNavMenu } from "@/components/console/navItems";

export default function ConsoleShell({
  navLabel,
  navItems,
  navMenu,
  profile = false,
  children,
}: {
  /** Accessible name of the menu <nav>. */
  navLabel: string;
  navItems: ReadonlyArray<ConsoleNavItem>;
  /** Opt-in grouped menu (collapsible sections; two-level pills on phones). Takes precedence over `navItems`. */
  navMenu?: ConsoleNavMenu;
  /** True on /account, whose panels have no heading of their own: the frame
   * supplies a screen-reader <h1>. */
  profile?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-6">
        {profile && <h1 className="sr-only">My account</h1>}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
          <div className="min-w-0 lg:sticky lg:top-24 lg:w-56 lg:shrink-0">
            <ConsoleSidebarNav items={navItems} menu={navMenu} label={navLabel} />
          </div>
          {/* min-w-0 so wide panel content (long emails, tables) can't force
              the flex row wider than the viewport. */}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </main>
  );
}
