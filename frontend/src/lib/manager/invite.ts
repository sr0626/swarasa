// Pure rules for the manager invite-by-email UI (no React, no fetch) so they
// are unit-testable with `node --test`.
//   cd frontend && npm run test:unit
import type { ManagerInvite } from "@/types/managerInvite";
import type { UserRole } from "@/types/auth";

/** Invites expire this long after creation (mirrors backend INVITE_TTL_DAYS). */
export const INVITE_TTL_DAYS = 14;
/** Invites one owner may create per rolling 24h (mirrors backend INVITES_PER_OWNER_PER_DAY). */
export const INVITES_PER_OWNER_PER_DAY = 20;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// `secrets.token_urlsafe(32)` is 43 chars of [A-Za-z0-9_-]; accept a little
// slack so a future length change doesn't break links, but nothing exotic.
const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

/** Trim + lowercase, exactly as the API normalises the address. */
export function normalizeInviteEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** An error message for an unusable address, or null when it is fine. */
export function validateInviteEmail(raw: string): string | null {
  const email = normalizeInviteEmail(raw);
  if (email.length === 0) return "Enter the email address of the person you're inviting.";
  if (email.length > 254 || !EMAIL_RE.test(email)) return "Enter a valid email address.";
  return null;
}

/** Whether a route param could be an invite token (cheap guard before calling the API). */
export function isPlausibleInviteToken(raw: unknown): raw is string {
  return typeof raw === "string" && TOKEN_RE.test(raw);
}

/** Same-site path of the acceptance page. */
export function invitePath(token: string): string {
  return `/invite/${encodeURIComponent(token)}`;
}

/** The shareable absolute link, built from the page's own origin. */
export function buildInviteLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}${invitePath(token)}`;
}

/** True when the post-auth `next` path is an invite page (sign-up then locks to a diner account). */
export function isInviteNextPath(next: string | null | undefined): boolean {
  return typeof next === "string" && next.startsWith("/invite/");
}

export type InviteLanding = "signed_out" | "can_accept" | "wrong_account_type";

/** What the acceptance page offers a visitor, from their session role (null = signed out). */
export function inviteLandingFor(role: UserRole | null): InviteLanding {
  if (role === null) return "signed_out";
  if (role === "registered_user" || role === "manager") return "can_accept";
  return "wrong_account_type";
}

/** Short label for an invite's status chip. */
export function inviteStatusLabel(status: ManagerInvite["status"]): string {
  return status === "expired" ? "Expired" : "Pending";
}

/** Pending first, then expired; each newest first (the API already sorts newest first). */
export function orderInvites(invites: ManagerInvite[]): ManagerInvite[] {
  const pending = invites.filter((i) => i.status === "pending");
  const expired = invites.filter((i) => i.status !== "pending");
  return [...pending, ...expired];
}

/**
 * Message for a failed create. The API already returns safe, user-facing text
 * (including the generic 429); only the status-specific hints are added here.
 */
export function createInviteErrorMessage(status: number | null, apiMessage: string | null): string {
  if (status === 429) return apiMessage ?? "You've sent too many invitations today. Please try again tomorrow.";
  if (status === 403) return "You don't have permission to invite managers for this location.";
  if (status === 422) return "Enter a valid email address.";
  return apiMessage ?? "Could not create this invitation. Please try again.";
}

/** Message for a failed accept (the API's text is deliberately generic; keep it). */
export function acceptInviteErrorMessage(status: number | null, apiMessage: string | null): string {
  if (status === 404) {
    return "This invitation is invalid, has expired, or was sent to a different email address. Ask the person who invited you for a new link, and make sure you're signed in with the address they invited.";
  }
  return apiMessage ?? "We couldn't complete this invitation. Please try again.";
}
