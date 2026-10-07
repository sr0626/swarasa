// Carries a new diner's city + ZIP from the signup form to their first
// sign-in. Cognito has no custom attribute for it (and adding one is a
// Terraform change, out of scope), and the user_profile row can only be
// written with a signed-in session — which doesn't exist until after the
// email-code confirmation and first login. So signup parks the values in
// sessionStorage (tab-scoped, cleared when the tab closes; never a token,
// never localStorage) and LoginForm flushes them to PATCH /auth/me once the
// session is established. Best-effort by design: if the diner confirms on
// another device/tab the values are simply gone and the account-page banner
// asks for them again — browsing is never blocked.
import type { UserLocationValues } from "@/lib/validation/userLocation";

const KEY = "swarasa.pendingLocation";

/** The slice of the Storage API this module needs (lets tests pass a fake). */
export interface PendingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): PendingStorage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null; // storage blocked
  }
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function savePendingLocation(
  email: string,
  location: UserLocationValues,
  storage: PendingStorage | null = browserStorage()
): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ email: normaliseEmail(email), ...location }));
  } catch {
    // quota / blocked — the banner is the fallback
  }
}

/**
 * Returns (and clears) the parked location if it was saved for this email;
 * null when nothing is parked, it belongs to someone else, or it is invalid.
 */
export function takePendingLocation(
  email: string,
  storage: PendingStorage | null = browserStorage()
): UserLocationValues | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: unknown; city?: unknown; postal_code?: unknown };
    if (parsed.email !== normaliseEmail(email)) return null; // someone else's — leave it
    storage.removeItem(KEY);
    // Shape check only (type-only import above keeps this module runnable by
    // the node test runner, which can't resolve the "@/" alias for values);
    // the server re-validates city/ZIP on PATCH /auth/me regardless.
    if (typeof parsed.city !== "string" || typeof parsed.postal_code !== "string") return null;
    if (!parsed.city.trim() || !/^\d{5}(-\d{4})?$/.test(parsed.postal_code)) return null;
    return { city: parsed.city, postal_code: parsed.postal_code };
  } catch {
    return null;
  }
}
