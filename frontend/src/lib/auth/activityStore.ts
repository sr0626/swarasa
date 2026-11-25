// The one activity record for this browser tab, shared by the cookie touch
// (useSessionActivity) and the token refresh loop (sessionKeepAlive).
import { isIdle, recordActivity, startActivity, type ActivityState } from "./activity";

let state: ActivityState | null = null;

/** A fresh sign-in starts a fresh record. */
export function resetActivity(): void {
  state = startActivity(Date.now());
}

export function noteActivity(): void {
  state = state ? recordActivity(state, Date.now()) : startActivity(Date.now());
}

export function isSessionIdle(): boolean {
  return state !== null && isIdle(state, Date.now());
}
