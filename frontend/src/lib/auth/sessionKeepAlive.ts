// Best-effort silent-refresh loop for a "keep me signed in" session
// (docs/PROJECT_PLAN.csv row 63). Started by components/auth/LoginForm.tsx
// right after a successful sign-in where the "Keep me signed in" checkbox
// was checked — see that file for the call site.
//
// DESIGN / SCOPING DECISION (documented in the PR description too — read
// that for the full reasoning, this is the short version):
//
// The httpOnly `rp_access_token` cookie only ever holds a Cognito *access*
// token, which is valid for just 1 hour regardless of the cookie's own
// Max-Age (infra/modules/cognito/main.tf `access_token_validity = 1`).
// getServerSession()/resolveSession() (lib/auth/session.ts) re-verify that
// token's own expiry on every read, so a stale token inside a 14-day cookie
// still reads as signed-out after an hour — a longer Max-Age alone changes
// nothing. Real 14-day retention needs the token itself refreshed before it
// goes stale, using the Cognito refresh token
// (`refresh_token_validity = 30` days, already provisioned, no infra
// change needed).
//
// What this module does: while the browser tab stays open (no hard reload,
// no browser restart), it schedules `fetchAuthSession({ forceRefresh: true
// })` shortly before the current access token's `exp`, then re-POSTs the
// refreshed token to POST /api/auth/session to re-mint the cookie — using
// only @aws-amplify/auth's public, documented API, nothing that depends on
// Amplify's internal token-storage format.
//
// What this module does NOT do — the documented, scoped-down gap: survive
// a full browser close/reopen or hard page reload. lib/auth/amplifyClient.ts
// deliberately keeps Cognito tokens in an in-memory KeyValueStorage (never
// localStorage, per frontend/CLAUDE.md), so a hard reload wipes Amplify's
// state along with any refresh token it held — there is nothing left in the
// browser for this loop to resume from at that point, even though the
// `rp_access_token`/`rp_remember_me` cookies may still be sitting there with
// days left on their Max-Age. Closing that gap for real needs the Cognito
// refresh token itself stored in a second, separate httpOnly cookie and a
// server-side refresh path (e.g. a Next.js Route Handler calling Cognito's
// `InitiateAuth`/`REFRESH_TOKEN_AUTH` directly, since the web app client has
// no secret) — flagged as a follow-up in the PR description, not built
// here: getting the raw refresh token out of Amplify's public API isn't
// supported today (`AuthTokens` only exposes `accessToken`/`idToken`), so
// doing this safely means either waiting on/requesting that from Amplify or
// moving off `@aws-amplify/auth` for the sign-in flow — too large a change
// to fold into this PR blind, without a real Cognito pool to verify against.
import { fetchAuthSession } from "@aws-amplify/auth";

/** Refresh this long before the access token's real expiry, not exactly at it. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
/** Never schedule sooner than this — avoids a refresh storm if `exp` is already close/past. */
const MIN_DELAY_MS = 10 * 1000;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

export function stopSessionKeepAlive(): void {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Idempotent — calling it while already running just no-ops instead of stacking timers. */
export function startSessionKeepAlive(): void {
  if (running) return;
  running = true;
  void scheduleFromCurrentSession();
}

async function scheduleFromCurrentSession(): Promise<void> {
  if (!running) return;
  try {
    const session = await fetchAuthSession();
    // ID token's own exp, not the access token's -- the session cookie
    // this loop keeps alive now holds the ID token (see the "accessToken"
    // field comment in refreshAndReschedule below for why).
    const exp = session.tokens?.idToken?.payload?.exp;
    if (!exp) {
      stopSessionKeepAlive();
      return;
    }
    const delay = Math.max(exp * 1000 - Date.now() - REFRESH_BUFFER_MS, MIN_DELAY_MS);
    timer = setTimeout(() => void refreshAndReschedule(), delay);
  } catch {
    // No usable session to schedule from — nothing to keep alive.
    stopSessionKeepAlive();
  }
}

async function refreshAndReschedule(): Promise<void> {
  if (!running) return;
  try {
    const refreshed = await fetchAuthSession({ forceRefresh: true });
    // Deliberately the ID token -- fixed 2026-09-18 alongside LoginForm.tsx,
    // see that file's comment for the full reasoning (Cognito access
    // tokens carry no `email` claim; the backend's lazy owner_account
    // provisioning needs one). Field is still named "accessToken" in the
    // request body/cookie -- a broader rename is a follow-up.
    const accessToken = refreshed.tokens?.idToken?.toString();
    if (!accessToken) {
      stopSessionKeepAlive();
      return;
    }

    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken, rememberMe: true }),
    });

    if (!res.ok) {
      // Refresh token itself is gone/expired (past its 30-day validity, or
      // revoked) — nothing more this loop can do.
      stopSessionKeepAlive();
      return;
    }

    await scheduleFromCurrentSession();
  } catch {
    stopSessionKeepAlive();
  }
}
