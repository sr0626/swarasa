// Pure, session-agnostic header markup shared by:
//   - components/home/TopBar.tsx (the async Server Component every normal
//     page renders — resolves the session, then hands this shell a
//     `greetingName` or `null`)
//   - app/error.tsx (a required Client Component — see its own comment for
//     exactly why it can't render the async `TopBar` directly)
//
// Deliberately has NO "use client" directive and NO import of
// `getServerSession()`/`next/headers` — that split is the whole reason this
// file exists. `TopBar.tsx` importing `next/headers` (via
// `lib/auth/session.ts`) is fine from a Server Component, but the moment
// `app/error.tsx` (which Next.js requires to be a Client Component) tried to
// import the session-aware `TopBar` directly, the build broke: "You're
// importing a component that needs next/headers... not supported in the
// pages/ directory" — `next/headers` can never be reachable from a Client
// Component's module graph, even indirectly. Splitting the presentational
// markup out here, with zero server-only imports, means BOTH callers can
// render the exact same header instead of `error.tsx` forking a second,
// hand-maintained copy of it.
import Link from "next/link";
import SwarasaMark from "@/components/icons/SwarasaMark";
import AccountMenu from "./AccountMenu";
import type { UserRole } from "@/types/auth";

export default function TopBarShell({
  greetingName,
  role = null,
}: {
  greetingName: string | null;
  /**
   * Omitted by app/error.tsx (a required Client Component that can't
   * safely re-derive the session mid-error — see its own comment), which
   * always passes `greetingName={null}` anyway, so the CTA below renders
   * its signed-out `/login` form regardless of this default.
   */
  role?: UserRole | null;
}) {
  return (
    // STICKY: stays visible on scroll. `sticky` (not `fixed`) keeps the bar
    // in normal flow so there is no layout shift and no spacer needed. Every
    // caller renders this as a direct child of a page-tall <main>, so the
    // sticky containing block spans the whole page. No ancestor sets
    // `overflow` (which would silently break sticky). `z-40` sits above page
    // content (nothing else in the app uses z-index) and the account
    // dropdown (`z-20`, absolutely positioned inside this header's stacking
    // context) is never clipped because the header has no `overflow` set.
    // `bg-brand-bg/95 backdrop-blur` keeps scrolled content from showing
    // through legibly.
    <header className="sticky top-0 z-40 border-b border-brand-border bg-brand-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="flex flex-col leading-tight">
          <span className="flex items-center gap-1.5 font-display text-xl font-bold text-brand-ink sm:text-2xl">
            <SwarasaMark className="h-5 w-auto text-brand-accent sm:h-6" />
            Swarasa
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-ink-subtle sm:text-xs">
            Discover Your Taste
          </span>
        </Link>

        <nav className="flex items-center gap-3 text-sm font-medium text-brand-ink-muted sm:gap-6">
          {greetingName ? (
            <AccountMenu greetingName={greetingName} />
          ) : (
            <Link href="/login" className="hidden transition hover:text-brand-ink sm:inline">
              Sign In
            </Link>
          )}
        </nav>

        {/* MOBILE OVERFLOW FIX (flagged in a prior PR's description): at
            375px, wordmark + account menu + this CTA together overflowed
            the viewport (measured 489px of content in a 375px viewport —
            frontend/CLAUDE.md "No horizontal scroll on mobile" / "Design
            for 375px viewport first"). The account menu already gives a
            signed-in visitor their own way into the app, so this
            acquisition CTA steps aside below `sm:` for that case only.
            Signed-out mobile layout is unchanged: shown at all widths.

            ROUTING (bug fix, flagged in this PR's description): this
            previously always linked to `/login`, including for an
            already-signed-in visitor — clicking it while signed in bounced
            them back to the sign-in page. Only an owner can actually
            create a restaurant (`POST /restaurants` is "Auth: owner",
            docs/API_CONTRACTS.md), so a signed-in owner now goes straight
            to the create-brand form and a signed-in manager/admin/
            registered_user — for whom this CTA doesn't apply — don't see
            it at all, rather than clicking into a page that would just
            403.

            SIGNED-OUT TARGET: `/signup?role=owner` (was `/login`). A
            visitor clicking "Add Your Restaurant" is by definition a
            prospective owner who most likely has no account yet, so a
            sign-in page is a dead end for them; the sign-up page
            pre-selects the Owner role and still links "Already have an
            account? Sign in" for returning owners. */}
        {(!greetingName || role === "owner") && (
          <Link
            href={greetingName ? "/portal/brands/new" : "/signup?role=owner"}
            className={`min-h-[44px] items-center whitespace-nowrap rounded-brand-pill bg-brand-ink px-4 text-sm font-semibold text-brand-bg transition hover:bg-brand-ink/90 sm:px-5 ${
              greetingName ? "hidden sm:flex" : "flex"
            }`}
          >
            Add Your Restaurant
          </Link>
        )}
      </div>
    </header>
  );
}
