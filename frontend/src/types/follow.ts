// Types for `user_follow` — docs/API_CONTRACTS.md "Follows (`user_follow`)".
// No frontend consumer existed before this page (checked: no other file in
// frontend/src referenced follows) despite the backend (PR #66) being Done.

/** One row of `GET /auth/me/follows` — a brand summary, not a full listing. */
export interface FollowedBrand {
  brand_id: number;
  name: string;
  slug: string;
  is_claimed: boolean;
  followed_at: string;
}

/** Response for `POST /restaurants/{id}/follow`. */
export interface FollowOut {
  brand_id: number;
  followed_at: string;
}
