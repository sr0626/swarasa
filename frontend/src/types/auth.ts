// Types for GET/PATCH /auth/me and the Cognito-backed session, matching
// docs/API_CONTRACTS.md "Auth (`/auth`)" and root CLAUDE.md's Cognito
// user pool groups.

/** Cognito user pool group, doubling as our app-level role. */
export type UserRole = "owner" | "manager" | "admin" | "registered_user";

/** null for manager/admin/registered_user — no local business record. */
export interface OwnerAccount {
  id: number;
  full_name: string | null;
  phone: string | null;
  stripe_customer_id: string | null;
}

/** Response for GET /auth/me. */
export interface AuthMe {
  cognito_sub: string;
  role: UserRole;
  email: string;
  // Unified display name regardless of backing source: owner_account.full_name
  // for an owner, the new generic `user_profile.full_name` for
  // registered_user/manager, null for admin (no local profile source yet
  // for any role) -- see docs/API_CONTRACTS.md "GET /auth/me". Added so
  // callers never need to know/branch on which table a role's name lives
  // in; prefer this over `owner_account?.full_name` everywhere except the
  // owner-only edit form, which still needs the full OwnerAccount shape
  // (id/phone/stripe_customer_id).
  full_name: string | null;
  owner_account: OwnerAccount | null;
}

/** Body for PATCH /auth/me (owner form). Always scoped to the authenticated caller. */
export interface UpdateAuthMeInput {
  full_name: string;
  phone: string;
}

/**
 * Body for the generalized PATCH /auth/me (registered_user/manager display
 * name only -- see docs/API_CONTRACTS.md "PATCH /auth/me"). Owner also
 * accepts this shape (phone is simply omitted/untouched), but owner UI
 * uses `UpdateAuthMeInput`/`updateCurrentUser` instead, unchanged.
 */
export interface UpdateProfileInput {
  full_name: string;
}

/** Response for the generalized PATCH /auth/me -- a registered_user/manager
 * caller only ever gets `full_name` back (no owner_account fields apply). */
export interface UpdateProfileResult {
  full_name: string | null;
}

/**
 * Minimal identity extracted server-side from a validated Cognito JWT.
 * Populated by frontend/src/lib/auth/session.ts — deliberately smaller than
 * AuthMe (no owner_account) since the session helper never calls the
 * backend itself, it only reads claims already present on the token.
 */
export interface Session {
  cognitoSub: string;
  email: string;
  role: UserRole;
  /** Raw JWT, for attaching to authenticated /lib/api calls as a Bearer token. */
  accessToken: string;
}
