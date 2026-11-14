// "Why join Swarasa" — the permanent home of the sign-up benefits that the
// homepage popup shows once. Server-rendered (no "use client"), public and
// indexable. The copy comes from lib/ui/signupBenefits.ts, the same module the
// popup imports, so the two cannot drift apart.
//
// The only data fetch is the session check TopBar already does: a signed-in
// visitor sees a friendly "You're signed in" panel instead of the sign-up calls
// to action. Catering is registered_user-only (/account/catering/new), so the
// shortcut to it is shown to that role alone.
import type { Metadata } from "next";
import Link from "next/link";
import BenefitIcon from "@/components/home/BenefitIcon";
import TopBar from "@/components/home/TopBar";
import { getServerSession } from "@/lib/auth/session";
import {
  BENEFITS_PATH,
  SIGNIN_HREF,
  SIGNIN_LABEL,
  SIGNUP_BENEFITS,
  SIGNUP_CTA_HREF,
  SIGNUP_CTA_LABEL,
  SIGNUP_FOOTNOTE,
} from "@/lib/ui/signupBenefits";

export const metadata: Metadata = {
  // `absolute` skips the "%s | Swarasa" template, which would repeat the brand.
  title: { absolute: "Why join Swarasa: free account benefits" },
  description:
    "A free Swarasa account lets you follow your favorite restaurants, get notified about new deals, search today's deals in full, request catering quotes and search near you automatically.",
  alternates: { canonical: BENEFITS_PATH },
  robots: { index: true, follow: true },
};

const FOCUS_RING =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2";

export default async function BenefitsPage() {
  const session = await getServerSession();
  const signedIn = session !== null;
  const isDiner = session?.role === "registered_user";

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />

      <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
        <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
          Why join Swarasa
        </h1>
        <p className="mt-3 text-base leading-relaxed text-brand-ink-muted">
          Browsing is free for everyone. A free account adds a few things that make finding
          and keeping up with your favorite desi restaurants easier.
        </p>

        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {SIGNUP_BENEFITS.map(({ id, title, detail, icon }) => (
            <li
              key={id}
              className="flex items-start gap-3 rounded-brand-card border border-brand-border bg-white p-4"
            >
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-brand-pill bg-brand-chip text-brand-chip-ink"
              >
                <BenefitIcon name={icon} className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <h2 className="text-base font-semibold text-brand-ink">{title}</h2>
                <p className="mt-0.5 text-sm text-brand-ink-muted">{detail}</p>
              </span>
            </li>
          ))}
        </ul>

        {signedIn ? (
          <div className="mt-8 rounded-brand-card border border-brand-border bg-white p-5">
            <h2 className="font-display text-xl font-bold text-brand-ink">You&apos;re signed in</h2>
            <p className="mt-1 text-sm text-brand-ink-muted">
              {isDiner
                ? "These are all yours already. Jump in:"
                : "Head to your account or start exploring:"}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Link
                href="/account"
                className={`flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover ${FOCUS_RING}`}
              >
                {isDiner ? "My favorites" : "My account"}
              </Link>
              {isDiner && (
                <Link
                  href="/account/catering/new"
                  className={`flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border px-6 text-sm font-semibold text-brand-accent transition hover:bg-brand-chip ${FOCUS_RING}`}
                >
                  Request catering quotes
                </Link>
              )}
              <Link
                href="/search"
                className={`flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border px-6 text-sm font-semibold text-brand-accent transition hover:bg-brand-chip ${FOCUS_RING}`}
              >
                Find restaurants
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-8">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href={SIGNUP_CTA_HREF}
                className={`flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover ${FOCUS_RING}`}
              >
                {SIGNUP_CTA_LABEL}
              </Link>
              <Link
                href={SIGNIN_HREF}
                className={`flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border px-6 text-sm font-semibold text-brand-accent transition hover:bg-brand-chip ${FOCUS_RING}`}
              >
                {SIGNIN_LABEL}
              </Link>
            </div>
            <p className="mt-3 text-xs text-brand-ink-subtle">{SIGNUP_FOOTNOTE}</p>
          </div>
        )}
      </section>
    </main>
  );
}
