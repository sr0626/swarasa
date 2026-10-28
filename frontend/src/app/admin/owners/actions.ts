"use server";

// Server Actions backing the admin owner-assignment UI: the listings "Assign
// owner" panel (components/admin/AssignOwnerPanel.tsx) and the Owners page
// "Add owner" form (components/admin/AddOwnerForm.tsx). Same "keep the
// Cognito access token server-side" rationale as admin/claims/actions.ts;
// every action independently re-checks `role === "admin"`.
import { ApiError } from "@/lib/api/client";
import { getAdminOwners } from "@/lib/api/adminOwners";
import { addOwner, assignOwner } from "@/lib/api/adminOwnerAssignment";
import { looksLikeEmail } from "@/lib/adminOwnerAssignment";
import { getServerSession } from "@/lib/auth/session";
import type {
  AddOwnerResponse,
  AssignOwnerInput,
  AssignOwnerResponse,
} from "@/types/adminOwnerAssignment";

export type OwnerOption = {
  id: number;
  email: string | null;
  full_name: string | null;
  brand_count: number;
};

export type SearchOwnersResult =
  | { ok: true; owners: OwnerOption[] }
  | { ok: false; error: string };
export type AssignOwnerResult =
  | { ok: true; result: AssignOwnerResponse }
  | { ok: false; error: string };
export type AddOwnerResult = { ok: true; owner: AddOwnerResponse } | { ok: false; error: string };

const GENERIC_ERROR = "Something went wrong. Please try again.";

async function requireAdminAccessToken(): Promise<
  { ok: true; accessToken: string } | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  if (session.role !== "admin") {
    return { ok: false, error: "Only admins can manage owners." };
  }
  return { ok: true, accessToken: session.accessToken };
}

function messageFor(error: unknown): string {
  return error instanceof ApiError ? error.message : GENERIC_ERROR;
}

/** GET /admin/owners?q= -- picker search (email or name), first page only. */
export async function searchOwnersAction(query: string): Promise<SearchOwnersResult> {
  const admin = await requireAdminAccessToken();
  if (!admin.ok) return admin;
  const q = query.trim().slice(0, 100);
  if (!q) return { ok: true, owners: [] };
  try {
    const data = await getAdminOwners(
      { q, page: 1, page_size: 10, sort: "email" },
      admin.accessToken
    );
    return {
      ok: true,
      owners: data.results
        .filter((owner) => !owner.personal_data_deleted)
        .map((owner) => ({
          id: owner.id,
          email: owner.email,
          full_name: owner.full_name,
          brand_count: owner.brand_count,
        })),
    };
  } catch (error) {
    return { ok: false, error: messageFor(error) };
  }
}

/** POST /admin/restaurants/{id}/assign-owner -- unclaimed brands only. */
export async function assignOwnerAction(
  brandId: number,
  input: AssignOwnerInput
): Promise<AssignOwnerResult> {
  const admin = await requireAdminAccessToken();
  if (!admin.ok) return admin;
  if ("owner_email" in input && !looksLikeEmail(input.owner_email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  try {
    const result = await assignOwner(brandId, input, admin.accessToken);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: messageFor(error) };
  }
}

/** POST /admin/owners -- pre-create the owner account of an existing Cognito owner. */
export async function addOwnerAction(email: string): Promise<AddOwnerResult> {
  const admin = await requireAdminAccessToken();
  if (!admin.ok) return admin;
  if (!looksLikeEmail(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  try {
    const owner = await addOwner(email.trim().toLowerCase(), admin.accessToken);
    return { ok: true, owner };
  } catch (error) {
    return { ok: false, error: messageFor(error) };
  }
}
