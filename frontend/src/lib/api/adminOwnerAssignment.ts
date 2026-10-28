// Typed client for the admin owner-assignment endpoints --
// docs/API_CONTRACTS.md "Admin: assign an owner to an unclaimed listing" and
// "POST /admin/owners". Auth: admin (callers pass the server-held token).
import { apiFetch } from "./client";
import type {
  AddOwnerResponse,
  AssignOwnerInput,
  AssignOwnerResponse,
} from "@/types/adminOwnerAssignment";

/** POST /admin/restaurants/{brandId}/assign-owner -- unclaimed brands only. */
export async function assignOwner(
  brandId: number,
  input: AssignOwnerInput,
  accessToken: string
): Promise<AssignOwnerResponse> {
  return apiFetch<AssignOwnerResponse>(
    `/admin/restaurants/${brandId}/assign-owner`,
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/** POST /admin/owners -- pre-create the owner_account of an existing Cognito owner-group user. */
export async function addOwner(email: string, accessToken: string): Promise<AddOwnerResponse> {
  return apiFetch<AddOwnerResponse>(
    "/admin/owners",
    { method: "POST", body: JSON.stringify({ email }) },
    { accessToken }
  );
}
