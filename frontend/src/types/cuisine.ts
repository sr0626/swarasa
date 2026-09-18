// docs/DATA_MODEL.md "cuisine_tag": category is one of these five values.
// Seeded from docs/TAXONOMY.md — no public write API, admin panel only.
export type CuisineCategory =
  | "regional"
  | "dietary"
  | "type"
  | "signature"
  | "dining_time";

export interface CuisineTag {
  // Added alongside backend/app/schemas/cuisine.py's `id` field — the
  // owner portal's create/edit-brand `cuisine_tag_ids` picker needs a real
  // id to submit, which this response didn't carry before.
  id: number;
  name: string;
  display_name: string;
  category: CuisineCategory;
}
