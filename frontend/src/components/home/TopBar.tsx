// Homepage top bar: wordmark + tagline, nav links, "Add Your Restaurant" CTA.
// Shared across "/", "/login", "/search", "/about", "/contact", "/terms",
// "/signup", "/signup/confirm", "/forgot-password",
// "/forgot-password/confirm", "/claim", and "/restaurant/[brandSlug]"
// (frontend/CLAUDE.md's shared-component convention) — the wordmark links
// back to "/" so every one of those pages has a way home, per user request.
// `app/error.tsx` also needs this header but can't render this component
// directly (see "SESSION-AWARE" note below) — it renders TopBarShell.tsx
// instead.
//
// HEADER ORDER (redesigned 2026-09-24): logo | role-specific nav links |
// account menu (or "Sign In") on the right; below `lg` the links collapse
// into a menu button. The link set per role lives in lib/nav/topBarLinks.ts,
// the markup in TopBarShell.tsx / TopBarNav.tsx.
//
// SESSION-AWARE, ASYNC SERVER COMPONENT (docs/PROJECT_PLAN.csv "Signed-in
// account dropdown in site header" — flagged in this PR's description):
// turned into an `async function` that calls `getServerSession()` itself,
// rather than having every call site fetch the session and pass it down as
// a prop. Every non-error call site already renders `<TopBar />` from a
// plain Server Component (none is a "use client" page — confirmed by
// reading each one), so React/Next.js resolves this async child during the
// server render regardless of whether the parent page itself is `async` —
// zero of those call sites need to change. This is the smaller, cleaner
// change: one file touched instead of many, and it matches the existing
// `getServerSession()`/`requireSession()` pattern already used by
// app/account/page.tsx and app/portal/dashboard/page.tsx.
//
// The one exception is `app/error.tsx`, which Next.js requires to be a
// Client Component (error boundaries need client-side state/`reset()`) —
// a Client Component's module graph can never reach `next/headers`
// (`getServerSession()`'s dependency), even transitively, so it renders
// `TopBarShell` directly instead, with `greetingName={null}` (that page
// can't safely re-derive the session mid-error anyway). See
// TopBarShell.tsx's header comment for the full story and why the
// presentational markup lives there instead of duplicated in two places.
//
// `getServerSession()` returning `null` (signed out, or an expired/invalid
// token) renders the exact same markup as before this change.
import TopBarShell from "./TopBarShell";
import { getServerSession } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/api/auth";
import { getAdminNotifications } from "@/lib/api/adminNotifications";
import type { AdminNotifications } from "@/types/adminNotifications";

/**
 * Best-effort greeting name for a signed-in session: `GET /auth/me`'s
 * unified `full_name` (docs/API_CONTRACTS.md "GET /auth/me") when present,
 * falling back to email — same fallback pattern app/account/page.tsx (PR
 * #80) already uses via `accountShared.ts`'s `displayNameFor`. Updated
 * (docs/PROJECT_PLAN.csv "Generic user display name for registered_user/
 * manager") to read `me.full_name` instead of `me.owner_account?.full_name`
 * directly — a registered_user/manager who has set a name via the new
 * `/account` display-name form now shows it here too, not just owner.
 * Unlike the account page, a failed `GET /auth/me` here must NOT blank out
 * the whole header — it falls back further, to the email already present
 * on the verified JWT (`Session.email`), so the account menu still renders
 * (just without a display name beyond the email) instead of silently
 * reverting to the signed-out nav.
 */
async function resolveGreetingName(accessToken: string, fallbackEmail: string): Promise<string> {
  try {
    const me = await getCurrentUser(accessToken);
    return me.full_name ?? me.email;
  } catch {
    return fallbackEmail;
  }
}

/**
 * Admin bell data (`GET /admin/notifications`). Runs on every TopBar render,
 * i.e. on each page load/navigation -- no polling. Best-effort: a failure
 * returns `null` (the bell shows an "unavailable" state) and never breaks
 * the header or the page.
 */
async function resolveNotifications(accessToken: string): Promise<AdminNotifications | null> {
  try {
    return await getAdminNotifications(accessToken);
  } catch {
    return null;
  }
}

export default async function TopBar({
  stickyOnMobile = true,
}: {
  /** `false` lets the header scroll away below `md` (the location editor does this to give the
   * form back ~77px of a phone screen -- see TopBarShell). Sticky from `md` up either way. */
  stickyOnMobile?: boolean;
} = {}) {
  const session = await getServerSession();
  // Run the two independent backend calls concurrently; the admin fetch is
  // skipped entirely for every other role.
  const [greetingName, notifications] = session
    ? await Promise.all([
        resolveGreetingName(session.accessToken, session.email),
        session.role === "admin" ? resolveNotifications(session.accessToken) : null,
      ])
    : [null, null];

  return (
    <TopBarShell
      greetingName={greetingName}
      role={session?.role ?? null}
      notifications={notifications}
      stickyOnMobile={stickyOnMobile}
    />
  );
}
