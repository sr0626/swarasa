// Small pieces shared by every role's /account layout (Diner/Owner/Manager/
// Admin views): role labels, display-name helpers and
// the repeated Tailwind class strings for cards and pill links, so a rebrand
// tweak lands in one place.
import type { AuthMe } from "@/types/auth";

export const ROLE_LABEL: Record<AuthMe["role"], string> = {
  owner: "Owner",
  manager: "Manager",
  admin: "Admin",
  registered_user: "Registered user",
};

/** Up to two initials from the display name; falls back to the email's
 * first character so the avatar is never empty. */
export function initialsFor(name: string | null, email: string): string {
  const source = name?.trim() ?? "";
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
    return `${first}${last}`.toUpperCase();
  }
  return (email[0] ?? "?").toUpperCase();
}

/** Full name when the user has one, otherwise their email. Reads the
 * unified `full_name` field (docs/API_CONTRACTS.md "GET /auth/me") rather
 * than `owner_account?.full_name` directly, so this works for every role
 * that has a name set — owner (owner_account) or registered_user/manager
 * (the generic user_profile table) alike. */
export function displayNameFor(me: AuthMe): string {
  return me.full_name?.trim() || me.email;
}

/** First word of the name for friendly greetings; null when there is no name
 * (callers then greet without one rather than showing an email). */
export function firstNameFor(me: AuthMe): string | null {
  const full = me.full_name?.trim();
  return full ? (full.split(/\s+/)[0] ?? null) : null;
}

/** True once a display name is set (non-empty after trimming). A set name is
 * locked: the UI never renders an editable name field for it again and the
 * backend rejects a change (`PATCH /auth/me` -> 409 `name_locked`); an admin
 * changes it on request. Shared by every role's account view so they can't
 * drift. */
export function isNameLocked(fullName: string | null | undefined): boolean {
  return (fullName?.trim() ?? "") !== "";
}

/** Short copy shown wherever a locked name is displayed read-only. */
export const NAME_LOCKED_NOTE = "To change your name, please contact an admin.";

export const cardClass =
  "rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6";

export const outlinePillLinkClass =
  "flex min-h-[44px] shrink-0 items-center justify-center whitespace-nowrap rounded-brand-pill border border-brand-ink px-5 text-sm font-semibold text-brand-ink transition hover:bg-brand-chip focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent";

export const primaryLinkClass =
  "flex min-h-[44px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2";

export const secondaryLinkClass =
  "flex min-h-[44px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-brand-control border border-brand-border bg-white px-4 text-sm font-semibold text-brand-ink transition hover:border-brand-ink-subtle hover:bg-brand-chip focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent";
