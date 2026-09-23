// Post-auth "return to" support (added with the restaurant-page claim CTA:
// a signed-out visitor clicking "Claim this restaurant" used to be bounced
// to /login and lose the /claim?brand_id=... destination entirely).
//
// `next` travels as a plain query param through login / sign-up / confirm,
// so it is attacker-controllable input. Only same-origin absolute PATHS are
// accepted -- anything else (full URLs, protocol-relative `//evil.com`,
// backslash tricks) is dropped, so this can never become an open redirect.
import type { UserRole } from "@/types/auth";

/** Returns `raw` if it is a safe same-site path, otherwise `null`. */
export function safeNextPath(raw: string | string[] | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.includes("\\")) return null;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw.charCodeAt(i) < 32) return null;
  }
  return raw;
}

/** Appends `?next=<path>` (or `&next=`) to an auth-flow href when `next` is set. */
export function withNext(href: string, next: string | null | undefined): string {
  if (!next) return href;
  return `${href}${href.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;
}

/**
 * "Sign in to see deals" target for signed-out visitors (product decision
 * 2026-09-23: unregistered users see only the content-free "Deal(s)
 * available today" badge and must sign in / register -- same as Follow -- to
 * see deal details). The same `/login?next=<current path>` mechanism as
 * FollowButton's signed-out link; `next` is validated by `safeNextPath`, so
 * an unsafe path yields plain `/login`. The login page links on to /signup
 * preserving `next`, so one href covers both sign-in and sign-up.
 */
export function dealSignInHref(currentPath: string): string {
  return withNext("/login", safeNextPath(currentPath));
}

/**
 * Whether `role` can actually use `path` -- so a diner who signs in from a
 * link meant for owners lands on the normal homepage instead of being
 * bounced by the destination's own guard straight back to /login. Mirrors
 * the `requireSession([...])` guards: /portal/brands/new is owner-only,
 * other /portal/* is owner/manager, /admin/* is admin; everything else
 * (e.g. /claim) is open to any signed-in role.
 */
export function pathAllowedForRole(path: string, role: UserRole): boolean {
  if (path.startsWith("/portal/brands/new")) return role === "owner";
  if (path.startsWith("/portal")) return role === "owner" || role === "manager";
  if (path.startsWith("/admin")) return role === "admin";
  return true;
}
