// Shared admin console frame for /admin/claims, /admin/reports and
// /admin/listings: banner + left menu + right panel (components/admin/
// AdminShell.tsx, which /account also uses for the admin Profile item).
//
// The layout re-checks the admin role, but each page still calls
// requireSession(["admin"]) itself -- layouts don't re-render on sibling
// navigation, so a layout alone is not a sufficient guard.
//
// Work queue badges: counts are fetched here once per server render
// (best-effort, ~1.5s bound -- on any failure the menu simply has no badges).
// A layout is NOT re-rendered on client-side navigation between /admin/* pages,
// so NavBadgesProvider re-fetches through a Server Action when the path
// changes; the TopBar bell (rendered per page) carries its own live counts.
import type { ReactNode } from "react";
import { requireSession } from "@/lib/auth/guards";
import { loadConsoleIdentity } from "@/lib/auth/consoleIdentity";
import { loadAdminNavBadges } from "@/lib/admin/navBadges";
import AdminShell from "@/components/admin/AdminShell";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession(["admin"]);

  // Banner identity and menu badges are both best-effort; fetched in parallel.
  const [me, navBadges] = await Promise.all([
    loadConsoleIdentity(session),
    loadAdminNavBadges(session.accessToken),
  ]);

  return (
    <AdminShell me={me} navBadges={navBadges}>
      {children}
    </AdminShell>
  );
}
