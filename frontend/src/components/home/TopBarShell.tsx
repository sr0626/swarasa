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

        {/* HEADER ORDER (swapped 2026-09-19, user request): "Add Your
            Restaurant" is now the plain link in the middle and "Sign In" is
            the prominent pill at the far right (where the account menu also
            lives once signed in) -- previously the other way round.

            MOBILE OVERFLOW (frontend/CLAUDE.md "No horizontal scroll on
            mobile"; 375px): wordmark + this link + the Sign In pill do not
            fit together, so "Add Your Restaurant" steps aside below `sm:`.
            Sign In (a short pill) now shows at every width -- it was hidden
            on mobile before, leaving signed-out phone visitors with no
            sign-in link at all.

            ROUTING: signed-out -> `/signup?role=owner` (a prospective owner
            has most likely no account yet; that page pre-selects Owner and
            links "Already have an account? Sign in"). Signed-in owner ->
            `/portal/brands/new` (`POST /restaurants` is owner-only,
            docs/API_CONTRACTS.md). Signed-in manager/admin/registered_user
            never see it -- it would just 403. */}
        <nav className="flex items-center text-sm font-medium text-brand-ink-muted">
          {(!greetingName || role === "owner") && (
            <Link
              href={greetingName ? "/portal/brands/new" : "/signup?role=owner"}
              className="hidden whitespace-nowrap transition hover:text-brand-ink sm:inline"
            >
              Add Your Restaurant
            </Link>
          )}
        </nav>

        {greetingName ? (
          <AccountMenu greetingName={greetingName} />
        ) : (
          <Link
            href="/login"
            className="flex min-h-[44px] items-center whitespace-nowrap rounded-brand-pill bg-brand-ink px-5 text-sm font-semibold text-brand-bg transition hover:bg-brand-ink/90"
          >
            Sign In
          </Link>
        )}
      </div>
    </header>
  );
}
