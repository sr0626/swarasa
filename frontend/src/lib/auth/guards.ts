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
import { redirect } from "next/navigation";
import { getServerSession } from "./session";
import { safeNextPath, withNext } from "./safeNext";
import type { Session, UserRole } from "@/types/auth";

export async function requireSession(
  allowedRoles: UserRole[],
  /** Same-site path to come back to after signing in (e.g. "/claim?brand_id=3"). */
  returnTo?: string,
): Promise<Session> {
  const session = await getServerSession();
  if (!session || !allowedRoles.includes(session.role)) {
    redirect(withNext("/login", safeNextPath(returnTo)));
  }
  return session;
}
