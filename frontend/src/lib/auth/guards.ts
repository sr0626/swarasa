// Server Component guard built on getServerSession, matching
// frontend/CLAUDE.md's "Auth-gated portal pages" pattern:
//
//   const session = await getServerSession();
//   if (!session || !["owner", "manager"].includes(session.role)) {
//     redirect("/login");
//   }
//
// requireSession() folds that into one call for the portal/admin route
// placeholders (and future pages) so each one doesn't repeat the check.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSession } from "./session";
import { PATHNAME_HEADER, safeNextPath, withNext } from "./safeNext";
import type { Session, UserRole } from "@/types/auth";

export async function requireSession(
  allowedRoles: UserRole[],
  /** Same-site path to come back to after signing in (e.g. "/claim?brand_id=3"). */
  returnTo?: string,
): Promise<Session> {
  const session = await getServerSession();
  if (!session) {
    // `x-pathname` is set by src/middleware.ts for the signed-in areas, so a
    // page that passes no `returnTo` still comes back after sign-in.
    const path = returnTo ?? headers().get(PATHNAME_HEADER);
    redirect(withNext("/login", safeNextPath(path)));
  }
  // Signed in, wrong role: say so. Sending them to the sign-in form would look
  // like being signed out while the header still shows the account menu.
  if (!allowedRoles.includes(session.role)) {
    redirect("/not-allowed");
  }
  return session;
}
