// Homepage top bar: wordmark + tagline, nav links, "Add Your Restaurant" CTA.
// Shared across "/", "/login", "/search", "/about", "/contact", "/terms",
// "/signup", "/signup/confirm", "/forgot-password",
// "/forgot-password/confirm", "/claim", and "/restaurant/[slug]"
// (frontend/CLAUDE.md's shared-component convention) — the wordmark links
// back to "/" so every one of those pages has a way home, per user request.
// `app/error.tsx` also needs this header but can't render this component
// directly (see "SESSION-AWARE" note below) — it renders TopBarShell.tsx
// instead.
//
// LINK TARGETS: the signed-out "Add Your Restaurant" CTA goes to
// `/signup?role=owner` (pre-selects the Owner role on the sign-up form);
// "Sign In" goes to `/login`. The separate "For Owners" nav link was removed
// at the user's request (2026-09-19) -- it duplicated the CTA. See
// TopBarShell.tsx for the sticky-header notes.
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

/**
 * Best-effort greeting name for a signed-in session: `owner_account.full_name`
 * when present, falling back to email — same fallback pattern
 * app/account/page.tsx (PR #80) already uses for its own greeting
 * (`me.owner_account?.full_name ?? me.email`). Unlike that page, a failed
 * `GET /auth/me` here must NOT blank out the whole header — it falls back
 * further, to the email already present on the verified JWT
 * (`Session.email`), so the account menu still renders (just without a
 * display name beyond the email) instead of silently reverting to the
 * signed-out nav.
 */
async function resolveGreetingName(accessToken: string, fallbackEmail: string): Promise<string> {
  try {
    const me = await getCurrentUser(accessToken);
    return me.owner_account?.full_name ?? me.email;
  } catch {
    return fallbackEmail;
  }
}

export default async function TopBar() {
  const session = await getServerSession();
  const greetingName = session
    ? await resolveGreetingName(session.accessToken, session.email)
    : null;

  return <TopBarShell greetingName={greetingName} role={session?.role ?? null} />;
}
