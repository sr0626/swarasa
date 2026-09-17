// Cookie names/max-ages shared between server-only code (session.ts, the
// route handlers, both of which use `next/headers` and so can only run in a
// Server Component / Route Handler) and client components that merely need
// to know a cookie's *name* (e.g. to check whether it's set) or a duration
// value — never anything that reads/writes the actual httpOnly cookie
// itself, which stays server-only.
//
// Split out from session.ts specifically so components/auth/LoginForm.tsx
// and lib/auth/sessionKeepAlive.ts ("use client") can import the
// cookie name without pulling `next/headers` into the client bundle (which
// Next.js rejects outright — it only resolves in a server context).

/** Set by the sign-in flow (app/api/auth/session/route.ts) once Cognito issues tokens. */
export const SESSION_COOKIE_NAME = "rp_access_token";

/**
 * Matches the Cognito access token TTL (docs/DECISIONS.md "Manager
 * permissions validated server-side on every write" — "JWT TTL is 15
 * minutes"). The session cookie must never outlive the token it carries.
 *
 * Used for a normal (non-"remember me") sign-in.
 */
export const SESSION_MAX_AGE_SECONDS = 15 * 60;

/**
 * "Keep me signed in" (docs/PROJECT_PLAN.csv row 63). Bounded by Cognito's
 * own `refresh_token_validity = 30` days (infra/modules/cognito/main.tf) —
 * 14 is the product-requested number, comfortably inside that ceiling, not
 * derived from it.
 *
 * IMPORTANT — this alone does not keep anyone signed in for 14 days: the
 * cookie only ever holds a Cognito *access* token, which is still only
 * valid for 1 hour (`access_token_validity = 1` in the same Terraform file)
 * regardless of the cookie's Max-Age. getServerSession()/resolveSession()
 * (session.ts) re-verify the token's own expiry on every read, so a stale
 * token inside a long-lived cookie still reads as signed-out after an hour.
 * What actually extends the session is lib/auth/sessionKeepAlive.ts
 * (started from components/auth/LoginForm.tsx right after sign-in), which
 * silently refreshes the token and re-mints this cookie before it goes
 * stale — see that file's own header comment for exactly how far that gets
 * and its documented gap (doesn't survive a full browser restart/hard
 * reload).
 */
export const REMEMBER_ME_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

/**
 * A plain (non-httpOnly, non-sensitive) boolean flag cookie: "was this
 * session started with 'remember me' checked?" Holds no identity or token
 * material — just "1" or absent — so it's safe to read from client
 * JavaScript. Currently written by POST /api/auth/session only; nothing
 * reads it back yet (lib/auth/sessionKeepAlive.ts is started directly from
 * LoginForm.tsx's own success path instead, since it already knows whether
 * the checkbox was checked) — kept as the one server-visible signal of
 * which mode a given cookie is in, useful for any future page that needs to
 * tell the two apart without decoding the access token itself.
 */
export const REMEMBER_ME_COOKIE_NAME = "rp_remember_me";
