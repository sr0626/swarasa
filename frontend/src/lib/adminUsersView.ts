// Pure helpers for the admin Users directory (/admin/users): URL state,
// status chips and which actions apply to a row. Kept out of the page so
// they can be unit tested (`npm run test:unit`, node --test; relative
// imports only). The server enforces every rule here again -- this only
// decides what the UI offers.
import type {
  AdminUserAction,
  AdminUserRole,
  AdminUserRow,
  AdminUserSort,
  AdminUserStatusFilter,
} from "../types/adminUsers.ts";

export const USER_SORTS: readonly AdminUserSort[] = ["newest", "oldest", "email", "last_seen"];

export const USER_SORT_LABELS: Record<AdminUserSort, string> = {
  newest: "Newest signup",
  oldest: "Oldest signup",
  email: "Email A-Z",
  last_seen: "Recently seen",
};

export const USER_ROLES: readonly AdminUserRole[] = ["admin", "owner", "manager", "registered_user"];

export const USER_ROLE_LABELS: Record<AdminUserRole, string> = {
  admin: "Admin",
  owner: "Owner",
  manager: "Manager",
  registered_user: "Registered user",
};

export const USER_STATUSES: readonly AdminUserStatusFilter[] = [
  "enabled",
  "disabled",
  "unconfirmed",
];

export const USER_STATUS_LABELS: Record<AdminUserStatusFilter, string> = {
  enabled: "Enabled",
  disabled: "Disabled",
  unconfirmed: "Unconfirmed",
};

/** An allowed filter value, else undefined (no filter). */
export function parseOption<T extends string>(
  value: string | undefined,
  allowed: readonly T[]
): T | undefined {
  return allowed.find((option) => option === value);
}

export interface UsersViewState {
  page?: number;
  q?: string;
  role?: AdminUserRole;
  status?: AdminUserStatusFilter;
  sort?: AdminUserSort;
}

/** `/admin/users` + the current filters; defaults are omitted for clean URLs. */
export function buildUsersHref(state: UsersViewState): string {
  const search = new URLSearchParams();
  if (state.q) search.set("q", state.q);
  if (state.role) search.set("role", state.role);
  if (state.status) search.set("status", state.status);
  if (state.sort && state.sort !== "newest") search.set("sort", state.sort);
  if (state.page && state.page > 1) search.set("page", String(state.page));
  const query = search.toString();
  return query ? `/admin/users?${query}` : "/admin/users";
}

export type ChipTone = "good" | "warn" | "bad" | "neutral";

export interface StatusChip {
  label: string;
  tone: ChipTone;
}

/** Chips use text (never colour alone) for each state that applies. */
export function statusChips(user: Pick<AdminUserRow, "enabled" | "confirmed" | "status">): StatusChip[] {
  const chips: StatusChip[] = [];
  chips.push(user.enabled ? { label: "Enabled", tone: "good" } : { label: "Disabled", tone: "bad" });
  chips.push(
    user.confirmed ? { label: "Confirmed", tone: "good" } : { label: "Unconfirmed", tone: "warn" }
  );
  if (user.status === "RESET_REQUIRED") chips.push({ label: "Password reset pending", tone: "warn" });
  if (user.status === "FORCE_CHANGE_PASSWORD") chips.push({ label: "Must change password", tone: "warn" });
  return chips;
}

/** Actions to offer on a row, mirroring the server's rules. */
export function availableActions(
  user: Pick<AdminUserRow, "enabled" | "confirmed" | "is_self">
): AdminUserAction[] {
  const actions: AdminUserAction[] = [];
  if (!user.confirmed) actions.push("confirm");
  if (!user.enabled) actions.push("enable");
  if (!user.is_self) {
    if (user.enabled) actions.push("disable");
    actions.push("reset-password");
  }
  return actions;
}

export const ACTION_LABELS: Record<AdminUserAction, string> = {
  disable: "Disable",
  enable: "Enable",
  confirm: "Confirm sign-up",
  "reset-password": "Reset password",
};

export const ACTION_DONE: Record<AdminUserAction, string> = {
  disable: "Account disabled.",
  enable: "Account enabled.",
  confirm: "Sign-up confirmed.",
  "reset-password": "Password reset. The user must use Forgot password to sign in again.",
};

/** Dialog body copy for each action. */
export function actionConfirmText(action: AdminUserAction, who: string): string {
  switch (action) {
    case "disable":
      return `${who} will be signed out and unable to sign in until you enable the account again.`;
    case "enable":
      return `${who} will be able to sign in again.`;
    case "confirm":
      return `Confirm the sign-up for ${who} without an email code. They can sign in right away.`;
    case "reset-password":
      return `${who}'s current password stops working. They must use Forgot password to set a new one.`;
  }
}

/** Maps a server-side admin-user action failure to friendly copy. */
export function actionErrorMessage(status: number, fallback: string): string {
  if (status === 403) return fallback || "You can't do that to your own account.";
  if (status === 404) return "That user no longer exists. Refresh the list.";
  if (status === 409) return fallback || "That action isn't available for this account.";
  return "Something went wrong. Please try again.";
}
