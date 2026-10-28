// Types for the manager invite-by-email endpoints — docs/API_CONTRACTS.md
// "Manager invites".

/** Outstanding invites only: accepted ones are managers now, revoked ones are gone. */
export type ManagerInviteStatus = "pending" | "expired";

/** One row of GET /locations/{id}/manager-invites (never carries the token). */
export interface ManagerInvite {
  id: number;
  location_id: number;
  /** Lowercased invitee address the owner typed. */
  email: string;
  status: ManagerInviteStatus;
  created_at: string;
  expires_at: string;
}

/** Response for POST /locations/{id}/manager-invites — `token` is shown ONCE. */
export interface ManagerInviteCreated extends ManagerInvite {
  token: string;
}

export interface ManagerInviteList {
  results: ManagerInvite[];
  page: number;
  page_size: number;
  total: number;
}

/** Response for the public POST /manager-invites/preview. */
export interface ManagerInvitePreview {
  brand_name: string;
  location_name: string | null;
  city: string;
  /** e.g. "j***@example.com" — which address to sign up with. */
  email_hint: string;
  expires_at: string;
}

/** Response for POST /manager-invites/accept. */
export interface ManagerInviteAccepted {
  location_id: number;
  brand_name: string;
  location_name: string | null;
  /** The account just joined the `manager` group; the session token must be reissued. */
  sign_in_again: boolean;
}
