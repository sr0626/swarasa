// Typed client for admin taxonomy management — docs/API_CONTRACTS.md
// "Admin taxonomy management". All three calls are auth: admin.
import { apiFetch } from "./client";
import type {
  AdminTag,
  AdminTagCreateInput,
  AdminTagUpdateInput,
  AdminTaxonomyResponse,
} from "@/types/adminTaxonomy";

/** GET /admin/taxonomy — every tag (active + inactive) with usage counts. */
export async function getAdminTaxonomy(accessToken: string): Promise<AdminTaxonomyResponse> {
  return apiFetch<AdminTaxonomyResponse>("/admin/taxonomy", { method: "GET" }, { accessToken });
}

/** POST /admin/taxonomy — 409 on a name clash. */
export async function createAdminTag(
  input: AdminTagCreateInput,
  accessToken: string
): Promise<AdminTag> {
  return apiFetch<AdminTag>(
    "/admin/taxonomy",
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/** PATCH /admin/taxonomy/{id} — rename and/or deactivate / reactivate. */
export async function updateAdminTag(
  id: number,
  input: AdminTagUpdateInput,
  accessToken: string
): Promise<AdminTag> {
  return apiFetch<AdminTag>(
    `/admin/taxonomy/${id}`,
    { method: "PATCH", body: JSON.stringify(input) },
    { accessToken }
  );
}
