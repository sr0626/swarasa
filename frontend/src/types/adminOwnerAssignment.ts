// Types for the admin owner-assignment endpoints -- docs/API_CONTRACTS.md
// "Admin: assign an owner to an unclaimed listing" and "POST /admin/owners".
// No billing fields by design.

/** Exactly one of the two (the API rejects both/neither with 422). */
export type AssignOwnerInput = { owner_id: number } | { owner_email: string };

export interface AssignOwnerResponse {
  brand_id: number;
  owner_id: number;
  owner_email: string;
  is_claimed: boolean;
  /** True when this call created the owner_account (Cognito owner-group user with no local row). */
  owner_account_created: boolean;
  /** Orphaned active managers revoked because they already work for a different owner. */
  revoked_manager_count: number;
}

export interface AddOwnerResponse {
  id: number;
  email: string;
  /** ISO timestamp. */
  joined_at: string;
}
