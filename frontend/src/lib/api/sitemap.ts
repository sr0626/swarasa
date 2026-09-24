// Typed client for GET /sitemap/locations — docs/API_CONTRACTS.md. Public;
// used only by app/sitemap.ts to list every ACTIVE location page.
import { apiFetch, toQueryString } from "./client";
import type { PaginatedResponse, PaginationParams } from "@/types/common";
import type { PublicLocationIndexItem } from "@/types/restaurant";

export async function getPublicLocationIndex(
  params: PaginationParams = {}
): Promise<PaginatedResponse<PublicLocationIndexItem>> {
  const query = toQueryString({ page: params.page, page_size: params.page_size });
  return apiFetch<PaginatedResponse<PublicLocationIndexItem>>(
    `/sitemap/locations${query}`,
    { method: "GET" },
    { revalidateSeconds: 3600 }
  );
}
