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
  /** True when any of the brand's active locations has a deal today. */
  has_deal_today: boolean;
  /** Up to 2 of today's deal titles (registered-user-only endpoint). */
  deal_titles_today: string[];
}

/** Response for `POST /restaurants/{id}/follow`. */
export interface FollowOut {
  brand_id: number;
  followed_at: string;
}
