// POST /api/auth/session — the missing half of the auth scaffold that
// shipped in the original frontend PR (lib/auth/session.ts's
// `getServerSession()` could only ever read a session cookie, never set
// one — see that file's history).
//
// The client-side sign-in form (components/auth/LoginForm.tsx)
// authenticates against Cognito directly via @aws-amplify/auth, then POSTs
// the access token it gets back here. This route re-verifies that token
// server-side (via `resolveSession()`, the same aws-jwt-verify logic
// `getServerSession()` uses) before trusting it enough to set it as the
// secure, httpOnly `rp_access_token` cookie — the token never sits in
// localStorage at any point in this flow (frontend/CLAUDE.md "NEVER store
// auth tokens in localStorage — use Cognito's secure cookie approach").
//
// "Keep me signed in" (docs/PROJECT_PLAN.csv row 63): an optional
// `rememberMe: boolean` in the body picks the cookie's Max-Age
// (SESSION_MAX_AGE_SECONDS vs REMEMBER_ME_MAX_AGE_SECONDS — see
// lib/auth/sessionConstants.ts for what that longer Max-Age does and does
// not achieve on its own) and toggles the plain, non-httpOnly
// `rp_remember_me` flag cookie that lib/auth/sessionKeepAlive.ts
// reads to decide whether to keep this session silently refreshed. This
// same route doubles as the re-mint endpoint SessionKeepAlive calls after a
// successful `fetchAuthSession({ forceRefresh: true })` — verify-then-set is
// exactly what a refresh also needs, so no separate route was added.
//
// DELETE (added for docs/PROJECT_PLAN.csv "Signed-in account dropdown in
// site header" — the Logout menu item, components/home/AccountMenu.tsx):
// clears both cookies this route sets. A new `DELETE` on the same route
// rather than a separate `/api/auth/logout` route — it's the same cookie
// pair, verify-then-set and clear are the two halves of one lifecycle, and
// it keeps cookie name/options (path, sameSite, secure) defined in exactly
// one place instead of two routes having to stay in sync. Needs no request
// body and returns no session data — deleting doesn't require re-verifying
// anything, unlike POST.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveSession } from "@/lib/auth/session";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  REMEMBER_ME_COOKIE_NAME,
  REMEMBER_ME_MAX_AGE_SECONDS,
} from "@/lib/auth/sessionConstants";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const accessToken =
    body && typeof body === "object" && "accessToken" in body
      ? (body as { accessToken: unknown }).accessToken
      : undefined;

  const rememberMe =
    body && typeof body === "object" && "rememberMe" in body
      ? (body as { rememberMe: unknown }).rememberMe === true
      : false;

  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const session = await resolveSession(accessToken);
  if (!session) {
    // Generic message — never surface verifier internals (root CLAUDE.md
    // "NEVER expose internal stack details in API error responses").
    return NextResponse.json(
      { error: "Could not establish session." },
      { status: 401 }
    );
  }

  const maxAge = rememberMe ? REMEMBER_ME_MAX_AGE_SECONDS : SESSION_MAX_AGE_SECONDS;

  cookies().set(SESSION_COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });

  if (rememberMe) {
    // Not httpOnly on purpose — it carries no identity/token material, just
    // a UI-preference flag SessionKeepAlive.tsx reads client-side (see
    // sessionConstants.ts).
    cookies().set(REMEMBER_ME_COOKIE_NAME, "1", {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge,
    });
  } else {
    cookies().delete(REMEMBER_ME_COOKIE_NAME);
  }

  // Only the role is returned — enough for the client to pick a landing
  // page (LoginForm.tsx), nothing more sensitive than what's already in
  // the JWT the client itself just supplied.
  return NextResponse.json({ role: session.role });
}

/**
 * Ends the session: deletes the httpOnly `rp_access_token` cookie
 * `getServerSession()` reads, and the `rp_remember_me` flag cookie
 * alongside it. Explicit `path: "/"` on both deletes to match exactly how
 * POST above sets them — cookie deletion only takes effect when path (and
 * domain) match the cookie that was set.
 *
 * Always succeeds (200) even when no session cookie was present — deleting
 * an absent cookie is a no-op, not an error, and the caller
 * (AccountMenu.tsx's logout handler) treats this as best-effort anyway: the
 * cookie clear is what actually ends the session, regardless of whether
 * there was anything to clear.
 */
export async function DELETE() {
  cookies().delete({ name: SESSION_COOKIE_NAME, path: "/" });
  cookies().delete({ name: REMEMBER_ME_COOKIE_NAME, path: "/" });
  return NextResponse.json({ ok: true });
}
