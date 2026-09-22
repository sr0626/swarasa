// Legacy /portal/dashboard route -- both owner and manager now have their
// full console at /account (owner: 2026-09-19; manager: this change), so
// this route is just a redirect that keeps login, the "create brand" flow,
// and old bookmarks working.
//
// FIXED STALE BUG (this change): the manager branch used to render a static
// "No location list available for managers yet" InfoPanel, explaining that
// no endpoint existed to list a manager's assigned locations. That was true
// when this page was first built, but `GET /auth/me/managed-locations`
// shipped in PR #78 and has been powering the manager section of /account
// (see components/account/ManagerAccountView.tsx) ever since -- the
// InfoPanel was stale copy nobody removed once the real feature landed.
// Rather than duplicate that already-working view here, this route now
// redirects managers to /account, the same way it already did for owners.
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/guards";

export default async function DashboardPage() {
  await requireSession(["owner", "manager"]);
  redirect("/account");
}
