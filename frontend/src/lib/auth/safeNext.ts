// Post-auth "return to" support (added with the restaurant-page claim CTA:
// a signed-out visitor clicking "Claim this restaurant" used to be bounced
// to /login and lose the /claim?brand_id=... destination entirely).
//
// `next` travels as a plain query param through login / sign-up / confirm,
// so it is attacker-controllable input. Only same-origin absolute PATHS are
// accepted -- anything else (full URLs, protocol-relative `//evil.com`,
// backslash tricks) is dropped, so this can never become an open redirect.

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
