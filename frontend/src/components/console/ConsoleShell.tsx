// Role-console frame: page background, TopBar, the dark identity banner, then
// a left vertical menu with the selected section's content in the right-hand
// panel. AdminShell and OwnerShell are thin wrappers that supply the label and
// menu items; a ManagerShell can do the same later. Pages inside render only
// their panel content, never their own <main>/TopBar.
import type { ReactNode } from "react";
import TopBar from "@/components/home/TopBar";
import ConsoleBanner from "@/components/console/ConsoleBanner";
import ConsoleSidebarNav from "@/components/console/ConsoleSidebarNav";
import type { ConsoleNavItem } from "@/components/console/navItems";
import type { AuthMe } from "@/types/auth";

export default function ConsoleShell({
  me,
  bannerLabel,
  navLabel,
  navItems,
  profile = false,
  children,
}: {
  me: AuthMe;
  /** Gold eyebrow in the banner, e.g. "Admin console". */
  bannerLabel: string;
  /** Accessible name of the menu <nav>. */
  navLabel: string;
  navItems: ReadonlyArray<ConsoleNavItem>;
  /** True on /account, where the user's name in the banner is the page <h1>. */
  profile?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <ConsoleBanner me={me} label={bannerLabel} nameAs={profile ? "h1" : "p"} />
        <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
          <div className="min-w-0 lg:sticky lg:top-24 lg:w-56 lg:shrink-0">
            <ConsoleSidebarNav items={navItems} label={navLabel} />
          </div>
          {/* min-w-0 so wide panel content (long emails, tables) can't force
              the flex row wider than the viewport. */}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </main>
  );
}
