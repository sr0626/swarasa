// Pure rules for "a session lasts while it is being used". No imports, so it
// runs directly under the node test runner.

/** Idle time after which a session without "keep me signed in" ends. Matches
 * SESSION_MAX_AGE_SECONDS (lib/auth/sessionConstants.ts), the cookie's life. */
export const IDLE_LIMIT_MS = 15 * 60 * 1000;

/** How often continued activity re-extends the session cookie. */
export const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface ActivityState {
  lastActivityAt: number;
  /** True once there was a gap longer than the idle limit since sign-in (or
   * since tracking started). The token refresh must never revive that session. */
  lapsed: boolean;
}

export function startActivity(now: number): ActivityState {
  return { lastActivityAt: now, lapsed: false };
}

export function isIdle(state: ActivityState, now: number): boolean {
  return state.lapsed || now - state.lastActivityAt > IDLE_LIMIT_MS;
}

export function recordActivity(state: ActivityState, now: number): ActivityState {
  return { lastActivityAt: now, lapsed: isIdle(state, now) };
}

export function shouldTouch(lastTouchAt: number | null, now: number): boolean {
  return lastTouchAt === null || now - lastTouchAt >= TOUCH_INTERVAL_MS;
}
