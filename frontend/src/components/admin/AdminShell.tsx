// Admin console frame shared by /account (Profile) and every /admin/* page:
// page background, TopBar, the "Admin console" banner, then a left vertical
// menu with the selected section's content in the right-hand panel.
//
// Used by exactly two callers so nothing is wrapped twice: app/admin/layout.tsx
// (Claims / Reports / Listings) and the admin branch of app/account/page.tsx
// (Profile). The pages inside render only their panel content, never their own
// <main>/TopBar.
import type { ReactNode } from "react";
import TopBar from "@/components/home/TopBar";
import AdminBanner from "@/components/admin/AdminBanner";
import AdminSidebarNav from "@/components/admin/AdminSidebarNav";
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
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <AdminBanner me={me} nameAs={profile ? "h1" : "p"} />
        <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
          <div className="min-w-0 lg:sticky lg:top-24 lg:w-56 lg:shrink-0">
            <AdminSidebarNav />
          </div>
          {/* min-w-0 so wide panel content (long emails, tables) can't force
              the flex row wider than the viewport. */}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </main>
  );
}
