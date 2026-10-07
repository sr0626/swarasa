// /privacy -- "Your data": CCPA data export and deletion request, moved here
// from the main account pages (user decision 2026-10-07) so the controls are
// reachable from the site footer without cluttering every role's account
// view. The component and server actions (components/account/
// DataPrivacySection.tsx, app/account/actions.ts) and backend endpoints are
// unchanged.
//
// Signed-in only: signed-out visitors are redirected to
// /login?next=/privacy (same requireSession pattern as /account) and come
// straight back after signing in. Admins are platform staff, so they see a
// short note instead of the controls (see lib/privacy/access.ts).
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import TopBar from "@/components/home/TopBar";
import DataPrivacySection from "@/components/account/DataPrivacySection";
import { getMyDataDeletionRequests } from "@/lib/api/auth";
import { latestDeletionRequestOf, privacyPageModeFor } from "@/lib/privacy/access";
import type { DataDeletionRequest } from "@/types/privacy";

export const metadata: Metadata = {
  title: "Privacy & Your Data",
  robots: { index: false },
};

export default async function PrivacyPage() {
  const session = await requireSession(
    ["owner", "manager", "admin", "registered_user"],
    "/privacy",
  );
  const mode = privacyPageModeFor(session.role);

  // Best-effort -- the section still renders (just without a known "already
  // pending" state) if this call fails.
  let latestDeletionRequest: DataDeletionRequest | null = null;
  if (mode === "controls") {
    try {
      const page = await getMyDataDeletionRequests({ page: 1, page_size: 5 }, session.accessToken);
      latestDeletionRequest = latestDeletionRequestOf(page.results);
    } catch {
      latestDeletionRequest = null;
    }
  }

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
          Privacy &amp; Your Data
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-brand-ink-muted">
          Under privacy laws such as the CCPA you can ask for a copy of the personal data we hold
          about you, and ask for it to be deleted. You can do both here. For how we handle data in
          general, see our{" "}
          <Link
            href="/terms"
            className="font-medium text-brand-accent transition hover:text-brand-accent-hover"
          >
            Terms &amp; Privacy
          </Link>{" "}
          page.
        </p>

        <div className="mt-6 max-w-2xl">
          {mode === "controls" ? (
            <DataPrivacySection latestDeletionRequest={latestDeletionRequest} />
          ) : (
            <section
              aria-labelledby="privacy-staff-heading"
              className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
            >
              <h2
                id="privacy-staff-heading"
                className="font-display text-xl font-bold text-brand-ink"
              >
                Admin accounts
              </h2>
              <p className="mt-1 text-sm text-brand-ink-muted">
                Data export and deletion requests are not offered for admin accounts, which are
                platform staff accounts. To change or close an admin account, contact another
                platform admin.
              </p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
