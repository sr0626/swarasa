// Contact Us — static contact-info page, not a form.
//
// JUDGMENT CALL (flagged in final report): a real contact form needs
// somewhere to send its submissions. Root CLAUDE.md defers SES (email) to
// Phase 2+ ("Cognito uses built-in mailer for Phase 1"), and there is no
// backend endpoint, table, or notification path for inbound contact
// messages anywhere in backend/ (checked routers/services). Building a
// form with no real delivery mechanism behind it would mean silently
// dropping user submissions, which is worse than not having a form. A
// static mailto: page is the correct Phase 1 scope; revisit once SES (or a
// simple contact_message table + admin queue, mirroring the claim-review
// pattern) lands in Phase 2.
//
// No physical/mailing address or phone number is used because none is
// decided anywhere in the repo (checked docs/BRD_v36_Restaurant_Platform.docx
// and docs/DECISIONS.md) — only an email is shown, via lib/contact.ts,
// which documents that same judgment call for the address itself.
import type { Metadata } from "next";
import Link from "next/link";
import TopBar from "@/components/home/TopBar";
import { CONTACT_EMAIL } from "@/lib/contact";

export const metadata: Metadata = {
  title: "Contact Us",
  description: "Get in touch with the Swarasa team.",
  alternates: {
    canonical: "/contact",
  },
};

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />

      <section className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-accent">
          Contact Us
        </p>
        <h1 className="mt-1 font-display text-3xl font-bold text-brand-ink sm:text-4xl">
          Get in touch
        </h1>
        <p className="mt-4 text-base leading-relaxed text-brand-ink-muted">
          Questions about a listing, a claim, or the platform in general?
          We&apos;d like to hear from you.
        </p>

        <div className="mt-8 rounded-brand-card border border-brand-border bg-white p-6 shadow-brand-card sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-ink-subtle">
            Email
          </p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="mt-1 inline-block font-display text-xl font-bold text-brand-accent hover:text-brand-accent-hover"
          >
            {CONTACT_EMAIL}
          </a>
          <p className="mt-3 text-sm text-brand-ink-muted">
            We aim to respond within 2 business days.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-2 text-sm text-brand-ink-muted">
          <p>
            Own or manage a restaurant already listed on Swarasa? Search for
            it and use the &quot;Claim this restaurant&quot; button on its
            listing page instead of emailing us &mdash; it gets you into the
            owner portal faster.
          </p>
          <p>
            Looking for our{" "}
            <Link
              href="/terms"
              className="font-semibold text-brand-ink underline underline-offset-2"
            >
              Terms &amp; Privacy
            </Link>{" "}
            information, or want to learn more{" "}
            <Link
              href="/about"
              className="font-semibold text-brand-ink underline underline-offset-2"
            >
              about Swarasa
            </Link>
            ?
          </p>
        </div>
      </section>
    </main>
  );
}
