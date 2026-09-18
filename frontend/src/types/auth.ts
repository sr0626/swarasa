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
  owner_account: OwnerAccount | null;
}

/** Body for PATCH /auth/me. Always scoped to the authenticated caller. */
export interface UpdateAuthMeInput {
  full_name: string;
  phone: string;
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
