// Admin claim review queue — auth-gated (admin only). Implements
// docs/DECISIONS.md "Claim flow" review actions against the real
// `POST /claim/{id}/approve` and `POST /claim/{id}/reject` endpoints
// (docs/API_CONTRACTS.md "Claim flow (`/claim`)").
//
// FLAGGED CONTRACT GAP (see PR description and ClaimReviewPanel.tsx's own
// note): the contract has no list-all-pending-claims endpoint, only
// `GET /claim/{id}`. This page is a lookup-by-id review tool, not a true
// queue — see ClaimReviewPanel for the full explanation and the endpoint
// this needs once it exists.
import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/guards";
import TopBar from "@/components/home/TopBar";
import ClaimReviewPanel from "@/components/admin/ClaimReviewPanel";

export const metadata: Metadata = {
  title: "Claims Review",
};

export default async function AdminClaimsPage() {
  await requireSession(["admin"]);

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
          Claims Review
        </h1>
        <p className="mt-2 text-sm text-brand-ink-muted">
          Approve or reject restaurant ownership claims.
        </p>

        <div className="mt-6">
          <ClaimReviewPanel />
        </div>
      </section>
    </main>
  );
}
