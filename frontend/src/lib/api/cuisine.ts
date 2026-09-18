// Typed client for /cuisine-tags — docs/API_CONTRACTS.md "GET /cuisine-tags".
// Public, no auth. Used by the owner portal's create/edit-brand cuisine tag
// picker (frontend/CLAUDE.md "NEVER fetch() inline in a component").
import { apiFetch } from "./client";
import type { CuisineCategory, CuisineTag } from "@/types/cuisine";

export async function getCuisineTags(category?: CuisineCategory): Promise<CuisineTag[]> {
  const query = category ? `?category=${category}` : "";
  const response = await apiFetch<{ results: CuisineTag[] }>(
    `/cuisine-tags${query}`,
    { method: "GET" },
    { revalidateSeconds: 3600 }
  );
  return response.results;
}
