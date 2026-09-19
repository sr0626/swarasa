// Manager dashboard + owner redirect. Owners no longer have a separate
// dashboard: their business page (stat tiles, restaurants, profile, security,
// data & privacy) is /account (2026-09-19), so this route just sends owners
// there -- login, the "create brand" flow and old bookmarks that still point
// at /portal/dashboard keep working through the redirect. The owner data
// loading lives in lib/owner/loadOwnerRestaurants.ts.
//
// FLAGGED CONTRACT GAP (see this route's original PR): `GET /restaurants` is
// "Auth: owner or admin" only — there is no manager path at all, and no
// other endpoint lets a manager discover which locations they're assigned
// to (the closest thing, `GET /locations/{id}/managers`, needs a location
// id up front, which is exactly what's missing). So a manager session
// cannot be listed here today; this page shows them a clear explanation
// instead of silently rendering nothing, and they can still reach a
// location editor directly if they have the link (see
// `/portal/locations/[id]/page.tsx`, which enforces access itself). A real
// fix needs a new backend endpoint (e.g. `GET /locations?assigned_to_me=true`
// or a manager-scoped branch of `GET /restaurants`) — flagged for
// Architect/Backend Dev, not built here.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/guards";
import TopBar from "@/components/home/TopBar";
import InfoPanel from "@/components/ui/InfoPanel";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const session = await requireSession(["owner", "manager"]);

  if (session.role === "owner") {
    redirect("/account");
  }

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
          Dashboard
        </h1>
        <p className="mt-2 text-sm text-brand-ink-muted">Signed in as manager.</p>

        <div className="mt-6">
          <InfoPanel
            title="No location list available for managers yet"
            body="There isn't a backend endpoint yet that lists which locations you're assigned to manage. Ask the owner who assigned you for a direct link to the location — you'll be able to open its editor at /portal/locations/{id} once you have the id."
          />
        </div>
      </section>
    </main>
  );
}
