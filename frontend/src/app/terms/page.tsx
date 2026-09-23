// Terms & Privacy — DRAFT PLACEHOLDER ONLY. Not real, binding legal
// language.
//
// See root CLAUDE.md's explicit instruction on this page and
// docs/DECISIONS.md "Terms & Privacy draft placeholder" for the full
// reasoning. Short version: docs/PROJECT_PLAN.csv already tracks "Privacy
// policy & Terms of Service" as a genuine Business/Legal task (BRD section
// 12, Appendix A open question #6 — "Legal review: privacy policy and
// terms of service approved before Phase 1 launch"), owned by Business /
// Legal, Not Started. An engineering agent fabricating real ToS/Privacy
// text and presenting it as reviewed would misrepresent that task as done.
// Instead this route exists with proper SSR/metadata/nav plumbing and a
// generic, clearly-labeled DRAFT boilerplate structure — so the route
// isn't empty/broken, but nobody could mistake it for a finalized legal
// document. Real content still needs Business/Legal sign-off before
// launch (tracked in docs/PROJECT_PLAN.csv).
//
// Combined Terms of Service + Privacy Policy on one page (route decision,
// flagged in final report): the BRD and PROJECT_PLAN.csv track both under
// a single "Privacy policy & Terms of Service" line item, and a flat
// top-level route matches the rest of the app's routing (/login, /claim,
// /search) rather than nesting under /legal. Splitting into two routes
// later is a small follow-up once real counsel-reviewed content exists for
// each.
import type { Metadata } from "next";
import Link from "next/link";
import TopBar from "@/components/home/TopBar";
import { CONTACT_EMAIL } from "@/lib/contact";

export const metadata: Metadata = {
  title: "Terms & Privacy",
  description:
    "Swarasa's Terms of Service and Privacy Policy (draft, pending legal review).",
  alternates: {
    canonical: "/terms",
  },
  // Draft/placeholder legal content — keep it out of search results until
  // real, reviewed content replaces it.
  robots: {
    index: false,
    follow: true,
  },
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-xl font-bold text-brand-ink">
        {title}
      </h2>
      <div className="mt-2 flex flex-col gap-3 text-sm leading-relaxed text-brand-ink-muted">
        {children}
      </div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />

      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div
          role="alert"
          className="rounded-brand-control border border-brand-closed bg-brand-closed-bg px-4 py-3 text-sm font-semibold text-brand-closed"
        >
          Draft &mdash; pending legal review, not yet in effect. This page is
          placeholder boilerplate, not a reviewed legal document, and
          creates no binding terms.
        </div>

        <p className="mt-8 text-sm font-semibold uppercase tracking-wide text-brand-accent">
          Terms &amp; Privacy
        </p>
        <h1 className="mt-1 font-display text-3xl font-bold text-brand-ink sm:text-4xl">
          Terms of Service &amp; Privacy Policy
        </h1>
        <p className="mt-4 text-sm text-brand-ink-muted">
          Last updated: draft, not yet published. This placeholder outlines
          the sections our final Terms of Service and Privacy Policy will
          cover once reviewed by counsel, ahead of Phase 1 launch.
        </p>

        <div className="mt-10 border-t border-brand-border pt-2">
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
            Terms of Service (draft)
          </p>

          <Section title="1. Acceptance of Terms">
            <p>
              By accessing or using Swarasa, you agree to be bound by these
              Terms of Service. If you do not agree, do not use the
              platform. [Placeholder &mdash; final acceptance language
              pending legal review.]
            </p>
          </Section>

          <Section title="2. User Accounts">
            <p>
              Registered users, restaurant owners, and location managers
              must provide accurate information when creating an account
              and are responsible for maintaining the confidentiality of
              their credentials. [Placeholder &mdash; final account terms
              pending legal review.]
            </p>
          </Section>

          <Section title="3. Restaurant Listings &amp; Claims">
            <p>
              Swarasa is an intermediary directory. Restaurant owners and
              managers are responsible for the accuracy of their own menu,
              pricing, and listing content. Claims are subject to
              verification before a listing is transferred to an owner
              account. [Placeholder &mdash; final listing/claim terms
              pending legal review.]
            </p>
          </Section>

          <Section title="4. Prohibited Uses">
            <p>
              Users may not submit false or misleading listing information,
              attempt to claim a restaurant they do not own or manage, scrape
              or misuse platform data, or otherwise interfere with the
              platform&apos;s operation. [Placeholder &mdash; final
              prohibited-use list pending legal review.]
            </p>
          </Section>

          <Section title="5. Limitation of Liability">
            <p>
              Swarasa provides listing information &quot;as is&quot; and
              makes no guarantee as to its accuracy. Swarasa is not liable
              for losses arising from reliance on listing content, deals, or
              third-party ordering links. [Placeholder &mdash; final
              liability language pending legal review.]
            </p>
          </Section>

          <Section title="6. Changes to Terms">
            <p>
              We may update these Terms from time to time. Material changes
              will be reflected on this page with an updated date once it is
              finalized. [Placeholder &mdash; final change-notice process
              pending legal review.]
            </p>
          </Section>
        </div>

        <div className="mt-10 border-t border-brand-border pt-2">
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
            Privacy Policy (draft)
          </p>

          <Section title="7. Information We Collect">
            <p>
              Account details (name, email, role), restaurant listing
              content submitted by owners/managers, and usage data needed to
              operate search, claims, and (for registered users) follows,
              deal alerts, and the searches and restaurant tiles they click
              while signed in (kept for 12 months, included in data
              exports, and removed on an approved deletion request). [Placeholder &mdash; final data inventory pending
              legal review.]
            </p>
          </Section>

          <Section title="8. How We Use Information">
            <p>
              To operate the directory, verify claims, enforce
              owner/manager/admin permissions, and, for registered users,
              deliver deal alerts for restaurants they follow. [Placeholder
              &mdash; final use-of-data language pending legal review.]
            </p>
          </Section>

          <Section title="9. Your Rights (CCPA)">
            <p>
              California residents (and, as a platform practice, any
              registered user) can request a copy of their personal data or
              request deletion of their account data. [Placeholder &mdash;
              final rights language pending legal review; see the data
              export/deletion flow available from your account.]
            </p>
          </Section>

          <Section title="10. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. Material
              changes will be reflected on this page with an updated date
              once it is finalized. [Placeholder &mdash; final change-notice
              process pending legal review.]
            </p>
          </Section>
        </div>

        <Section title="Contact">
          <p>
            Questions about these draft terms? Reach us at{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-semibold text-brand-ink underline underline-offset-2"
            >
              {CONTACT_EMAIL}
            </a>{" "}
            or visit{" "}
            <Link
              href="/contact"
              className="font-semibold text-brand-ink underline underline-offset-2"
            >
              Contact Us
            </Link>
            .
          </p>
        </Section>
      </section>
    </main>
  );
}
