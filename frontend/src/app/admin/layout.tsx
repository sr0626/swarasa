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
import { getCurrentUser } from "@/lib/api/auth";
import AdminShell from "@/components/admin/AdminShell";
import type { AuthMe } from "@/types/auth";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession(["admin"]);

  // Banner identity is best-effort: fall back to the session's own claims so
  // a failed GET /auth/me never takes the admin pages down.
  let me: AuthMe;
  try {
    me = await getCurrentUser(session.accessToken);
  } catch {
    me = {
      cognito_sub: session.cognitoSub,
      role: session.role,
      email: session.email,
      owner_account: null,
    };
  }

  return <AdminShell me={me}>{children}</AdminShell>;
}
