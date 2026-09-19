// Shared admin console frame for /admin/claims, /admin/reports and
// /admin/listings: banner + left menu + right panel (components/admin/
// AdminShell.tsx, which /account also uses for the admin Profile item).
//
// The layout re-checks the admin role, but each page still calls
// requireSession(["admin"]) itself -- layouts don't re-render on sibling
// navigation, so a layout alone is not a sufficient guard.
//
// No per-section notification badges in the menu on purpose: a layout is not
// re-rendered when navigating between /admin/* pages, so counts fetched here
// would go stale after approving a claim. The TopBar bell (rendered per page)
// already carries the live counts.
import type { ReactNode } from "react";
import { requireSession } from "@/lib/auth/guards";
import { loadConsoleIdentity } from "@/lib/auth/consoleIdentity";
import AdminShell from "@/components/admin/AdminShell";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession(["admin"]);

  // Banner identity is best-effort (falls back to the session claims).
  const me = await loadConsoleIdentity(session);

  return <AdminShell me={me}>{children}</AdminShell>;
}
