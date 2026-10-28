"use server";

// Server Actions backing the admin taxonomy page (AdminTaxonomyPanel.tsx) —
// same "keep the Cognito access token server-side, re-check the admin role"
// shape as admin/messages/actions.ts.
import { ApiError } from "@/lib/api/client";
import { createAdminTag, updateAdminTag } from "@/lib/api/adminTaxonomy";
import { getServerSession } from "@/lib/auth/session";
import { KIND_ORDER, validateDisplayName, normalizeDisplayName } from "@/lib/adminTaxonomyView";
import type { AdminTag } from "@/types/adminTaxonomy";
import type { CuisineCategory } from "@/types/cuisine";

export type TaxonomyActionResult = { ok: true; tag: AdminTag } | { ok: false; error: string };

async function adminToken(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: "Your session has expired. Please sign in again." };
  if (session.role !== "admin") return { ok: false, error: "Only admins can manage tags." };
  return { ok: true, token: session.accessToken };
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return "That tag no longer exists.";
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

/** POST /admin/taxonomy */
export async function createTagAction(
  displayName: string,
  category: CuisineCategory
): Promise<TaxonomyActionResult> {
  const admin = await adminToken();
  if (!admin.ok) return admin;
  const invalid = validateDisplayName(displayName);
  if (invalid) return { ok: false, error: invalid };
  if (!KIND_ORDER.includes(category)) return { ok: false, error: "Choose a valid kind." };
  try {
    const tag = await createAdminTag(
      { display_name: normalizeDisplayName(displayName), category },
      admin.token
    );
    return { ok: true, tag };
  } catch (error) {
    return { ok: false, error: messageFor(error) };
  }
}

/** PATCH /admin/taxonomy/{id} — rename. */
export async function renameTagAction(
  tagId: number,
  displayName: string
): Promise<TaxonomyActionResult> {
  const admin = await adminToken();
  if (!admin.ok) return admin;
  const invalid = validateDisplayName(displayName);
  if (invalid) return { ok: false, error: invalid };
  try {
    const tag = await updateAdminTag(
      tagId,
      { display_name: normalizeDisplayName(displayName) },
      admin.token
    );
    return { ok: true, tag };
  } catch (error) {
    return { ok: false, error: messageFor(error) };
  }
}

/** PATCH /admin/taxonomy/{id} — deactivate / reactivate. */
export async function setTagActiveAction(
  tagId: number,
  isActive: boolean
): Promise<TaxonomyActionResult> {
  const admin = await adminToken();
  if (!admin.ok) return admin;
  try {
    const tag = await updateAdminTag(tagId, { is_active: isActive }, admin.token);
    return { ok: true, tag };
  } catch (error) {
    return { ok: false, error: messageFor(error) };
  }
}
