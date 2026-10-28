// Types for admin taxonomy management — GET/POST/PATCH /admin/taxonomy.
// Mirrors backend/app/schemas/admin_taxonomy.py (docs/API_CONTRACTS.md
// "Admin taxonomy management").
import type { CuisineCategory } from "@/types/cuisine";

export interface AdminTag {
  id: number;
  /** Immutable slug (what search filters use). */
  name: string;
  display_name: string;
  category: CuisineCategory;
  is_active: boolean;
  /** Locations currently carrying the tag. */
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export interface AdminTaxonomyResponse {
  results: AdminTag[];
  categories: CuisineCategory[];
}

export interface AdminTagCreateInput {
  display_name: string;
  category: CuisineCategory;
  /** Optional; the server derives it from display_name when omitted. */
  name?: string;
}

export interface AdminTagUpdateInput {
  display_name?: string;
  is_active?: boolean;
}

/** Server-side bounds, shared by the form and the server action. */
export const TAG_DISPLAY_NAME_MAX_LENGTH = 120;
