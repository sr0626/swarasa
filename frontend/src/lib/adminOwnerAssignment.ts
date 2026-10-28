// Pure helpers for the admin "Assign owner" / "Add owner" UI. No React/Next
// imports and relative imports only, so they run under `node --test`
// (see adminOwnerAssignment.test.ts).
import type { AssignOwnerInput, AssignOwnerResponse } from "../types/adminOwnerAssignment.ts";

/** Light shape check mirroring the API's (Cognito is the real arbiter). */
export function looksLikeEmail(value: string): boolean {
  const cleaned = value.trim();
  if (!cleaned || /\s/.test(cleaned)) return false;
  const at = cleaned.indexOf("@");
  if (at < 1) return false;
  const domain = cleaned.slice(at + 1);
  return domain.includes(".") && !domain.includes("@") && !domain.startsWith(".") && !domain.endsWith(".");
}

/** An "Assign owner" action is offered only for a live brand with no owner and no pending claim. */
export function canAssignOwner(brand: {
  owner_id: number | null;
  deleted_at: string | null;
  has_pending_claim: boolean;
}): boolean {
  return brand.owner_id === null && !brand.deleted_at && !brand.has_pending_claim;
}

/** Why the action is hidden, for the one case an admin might wonder about. */
export function assignBlockedReason(brand: {
  owner_id: number | null;
  deleted_at: string | null;
  has_pending_claim: boolean;
}): string | null {
  if (brand.owner_id !== null || brand.deleted_at) return null;
  return brand.has_pending_claim ? "Review the pending claim to give this listing an owner." : null;
}

/**
 * The request body for the chosen target: a picked existing owner wins;
 * otherwise a well-formed typed email (lower-cased, trimmed) is looked up
 * server-side. `null` = nothing assignable yet.
 */
export function assignTarget(
  selectedOwnerId: number | null,
  typedEmail: string
): AssignOwnerInput | null {
  if (selectedOwnerId !== null) return { owner_id: selectedOwnerId };
  if (looksLikeEmail(typedEmail)) return { owner_email: typedEmail.trim().toLowerCase() };
  return null;
}

/** "owner@x.com -- Priya Sharma (2 restaurants)". */
export function ownerOptionLabel(owner: {
  email: string | null;
  full_name: string | null;
  brand_count: number;
}): string {
  const email = owner.email ?? "Deleted account";
  const name = owner.full_name ? ` — ${owner.full_name}` : "";
  const n = owner.brand_count;
  return `${email}${name} (${n} ${n === 1 ? "restaurant" : "restaurants"})`;
}

/** Confirmation sentence shown before the assign request is sent. */
export function assignConfirmText(brandName: string, targetLabel: string): string {
  return `Assign “${brandName}” to ${targetLabel}? The listing will show as claimed by this owner, and they can manage it from their portal. Pricing tier is not changed.`;
}

/** Success line after an assignment. */
export function assignSummary(result: AssignOwnerResponse): string {
  const parts = [`Assigned to ${result.owner_email}.`];
  if (result.owner_account_created) parts.push("Their owner account was created.");
  if (result.revoked_manager_count > 0) {
    const n = result.revoked_manager_count;
    parts.push(
      `${n} existing manager ${n === 1 ? "assignment was" : "assignments were"} removed because ` +
        `${n === 1 ? "that person already works" : "those people already work"} for another owner.`
    );
  }
  return parts.join(" ");
}

/** The listing fields that change locally after a successful assignment. */
export function applyAssignment<
  T extends {
    owner_id: number | null;
    owner_email: string | null;
    owner_deleted: boolean;
    is_claimed: boolean;
  },
>(brand: T, result: AssignOwnerResponse): T {
  return {
    ...brand,
    owner_id: result.owner_id,
    owner_email: result.owner_email,
    owner_deleted: false,
    is_claimed: result.is_claimed,
  };
}
