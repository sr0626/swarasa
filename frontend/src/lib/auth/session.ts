// Server-side Cognito session helper — matches the `getServerSession`
// pattern in frontend/CLAUDE.md's "Auth-gated portal pages" section.
//
// Reads the Cognito access token from a secure, httpOnly cookie and
// verifies it — never localStorage (frontend/CLAUDE.md "NEVER store auth
// tokens in localStorage — use Cognito's secure cookie approach"). Uses
// `next/headers` cookies(), so this file only works from Server Components,
// Route Handlers, and Server Actions (not Client Components) — that's the
// same boundary the auth-gated portal pattern relies on.
//
// The sign-in exchange that sets this cookie is now built: the client-side
// form (components/auth/LoginForm.tsx) authenticates against Cognito
// directly via @aws-amplify/auth, then POSTs the resulting access token to
// app/api/auth/session/route.ts, which calls `resolveSession()` below to
// verify it with the same aws-jwt-verify logic `getServerSession()` uses,
// before trusting it enough to set as the httpOnly cookie.
import { cookies } from "next/headers";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { assertCognitoConfig } from "./config";
import { SESSION_COOKIE_NAME } from "./sessionConstants";
import type { Session, UserRole } from "@/types/auth";

// Cookie names/max-ages now live in ./sessionConstants (no `next/headers`
// dependency, so client components can import them too — see that file's
// header comment) and are re-exported here so every existing import of
// `SESSION_COOKIE_NAME`/`SESSION_MAX_AGE_SECONDS` from "./session" (or the
// "@/lib/auth" barrel) keeps working unchanged.
export {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  REMEMBER_ME_MAX_AGE_SECONDS,
  REMEMBER_ME_COOKIE_NAME,
} from "./sessionConstants";

const ROLES: readonly UserRole[] = [
  "owner",
  "manager",
  "admin",
  "registered_user",
];

type CognitoAccessVerifier = ReturnType<typeof CognitoJwtVerifier.create>;
let verifier: CognitoAccessVerifier | null = null;

function getVerifier(): CognitoAccessVerifier {
  if (!verifier) {
    const { userPoolId, clientId } = assertCognitoConfig();
    // tokenUse: "id", not "access" (fixed 2026-09-18 — a real production
    // bug: every real owner hit "An email claim is required to provision
    // an owner account" on first login). This file's own comment below
    // already knew access tokens carry no email claim and assumed callers
    // would "follow up with GET /auth/me" -- but that endpoint receives
    // this exact same cookie/token as its Bearer credential, so it hit the
    // identical gap; there was no token anywhere in the flow that actually
    // carried email. The ID token carries the same cognito:groups claim
    // this file already reads for role extraction, plus sub and email --
    // switching what's verified here (LoginForm.tsx/sessionKeepAlive.ts
    // now send the ID token, not the access token) closes the gap with no
    // Cognito-side reconfiguration.
    verifier = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: "id",
      clientId,
    });
  }
  return verifier;
}

/** Picks the first pool group that matches one of our known roles. */
function roleFromGroups(groups: unknown): UserRole | null {
  if (!Array.isArray(groups)) return null;
  return ROLES.find((role) => groups.includes(role)) ?? null;
}

/**
 * Verifies a raw Cognito access token JWT and extracts a `Session` from it.
 * Returns null when the token is expired/invalid, or carries no recognized
 * pool group.
 *
 * Shared by `getServerSession()` below (cookie path, used by every
 * auth-gated Server Component) and `POST /api/auth/session`
 * (app/api/auth/session/route.ts, the sign-in route handler that verifies
 * a token the client just received from Cognito before trusting it enough
 * to set as a cookie) — one verification path, two callers.
 */
export async function resolveSession(token: string): Promise<Session | null> {
  try {
    const payload = await getVerifier().verify(token);
    const role = roleFromGroups(payload["cognito:groups"]);
    if (!role) return null;

    return {
      cognitoSub: payload.sub,
      // Reliably present now that this verifies an ID token (see
      // getVerifier() above) -- was previously often empty when this
      // verified an access token instead.
      email: typeof payload.email === "string" ? payload.email : "",
      role,
      accessToken: token,
    };
  } catch {
    return null;
  }
}

/**
 * Reads and verifies the caller's Cognito session, server-side.
 * Returns null when there's no cookie, the token is expired/invalid, or it
 * carries no recognized pool group — callers should treat that the same as
 * "signed out" and redirect("/login") (see frontend/CLAUDE.md's
 * auth-gated portal pattern), not surface a verification error to the page.
 */
export async function getServerSession(): Promise<Session | null> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return resolveSession(token);
}
