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
import AdminNotificationsBell from "./AdminNotificationsBell";
import { TopBarDesktopNav, TopBarMobileNav } from "./TopBarNav";
import { topBarLinksFor } from "@/lib/nav/topBarLinks";
import type { AdminNotifications } from "@/types/adminNotifications";
import type { UserRole } from "@/types/auth";

export default function TopBarShell({
  greetingName,
  role = null,
  notifications = null,
}: {
  greetingName: string | null;
  /**
   * Omitted by app/error.tsx (a required Client Component that can't
   * safely re-derive the session mid-error — see its own comment), which
   * always passes `greetingName={null}` anyway, so the CTA below renders
   * its signed-out `/login` form regardless of this default.
   */
  role?: UserRole | null;
  /**
   * Admin bell data from `GET /admin/notifications`, resolved by TopBar.tsx.
   * `null` = the fetch failed (bell still renders, in an "unavailable"
   * state). Ignored unless `role === "admin"`; app/error.tsx omits it.
   */
  notifications?: AdminNotifications | null;
}) {
  const links = topBarLinksFor(greetingName ? role : null);
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
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-4 sm:gap-4 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 flex-col leading-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
        >
          <span className="flex items-center gap-1.5 font-display text-xl font-bold text-brand-ink sm:text-2xl">
            <SwarasaMark className="h-5 w-auto text-brand-accent sm:h-6" />
            Swarasa
          </span>
          <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-brand-ink-subtle sm:text-xs sm:tracking-[0.14em]">
            Discover Your Taste
          </span>
        </Link>

        {/* HEADER LAYOUT (redesign, user request 2026-09-24: "important links
            based on the user type ... instead of empty space"): logo | role-
            specific links in the middle | account menu / Sign in on the right.
            The link set comes from lib/nav/topBarLinks.ts (one map from
            session role to links; every href is an existing route). From `lg`
            the links are inline; below it they collapse into the menu button
            at the end of the right-hand cluster (TopBarNav.tsx), so nothing
            overflows at 375px.

            The old middle-slot "Add Your Restaurant" pill is now just the `cta`
            link in that set (signed-out -> `/login?next=/portal/brands/new`,
            owner -> `/portal/brands/new`; manager/admin/registered_user never
            get it -- `POST /restaurants` is owner-only). It is reachable on
            mobile now too, via the menu. "Sign In" stays a single plain link on
            the right, and there is still no separate "For Owners" link. */}
        <TopBarDesktopNav links={links} />

        <div className="flex items-center gap-1 sm:gap-2">
          {greetingName ? (
            <>
              {/* Admin bell: only when the session role is admin. `notifications`
                  is fetched by TopBar.tsx (null = fetch failed). This wrapper is
                  deliberately NOT positioned so the bell's dropdown can anchor
                  to the header on mobile (see AdminNotificationsBell.tsx). */}
              {role === "admin" && <AdminNotificationsBell data={notifications} />}
              <AccountMenu greetingName={greetingName} role={role} />
            </>
          ) : (
            <Link
              href="/login"
              className="flex min-h-[44px] items-center whitespace-nowrap px-1 text-sm font-medium text-brand-ink-muted transition hover:text-brand-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
            >
              Sign In
            </Link>
          )}
          <TopBarMobileNav links={links} />
        </div>
      </div>
    </header>
  );
}
