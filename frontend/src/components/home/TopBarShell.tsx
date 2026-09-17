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

export default function TopBarShell({ greetingName }: { greetingName: string | null }) {
  return (
    <header className="border-b border-brand-border bg-brand-bg">
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
            <>
              <Link href="/login" className="hidden transition hover:text-brand-ink sm:inline">
                For Owners
              </Link>
              <Link href="/login" className="hidden transition hover:text-brand-ink sm:inline">
                Sign In
              </Link>
            </>
          )}
        </nav>

        {/* MOBILE OVERFLOW FIX (flagged in this PR's description): at 375px,
            wordmark + account menu + this CTA together overflowed the
            viewport (measured 489px of content in a 375px viewport —
            frontend/CLAUDE.md "No horizontal scroll on mobile" / "Design
            for 375px viewport first"). The account menu already gives a
            signed-in visitor their own way into the app, so this
            acquisition CTA — which still only ever points at `/login`,
            not obviously useful to someone already signed in — steps
            aside below `sm:` for that case only. Signed-out mobile layout
            is byte-for-byte unchanged: this link was never conditionally
            hidden before this task, and still isn't for a signed-out
            visitor. */}
        <Link
          href="/login"
          className={`min-h-[44px] items-center whitespace-nowrap rounded-brand-pill bg-brand-ink px-4 text-sm font-semibold text-brand-bg transition hover:bg-brand-ink/90 sm:px-5 ${
            greetingName ? "hidden sm:flex" : "flex"
          }`}
        >
          Add Your Restaurant
        </Link>
      </div>
    </header>
  );
}
