// Pure decision logic for the homepage "Get more from Swarasa" sign-up popup
// (components/home/SignupPromptModal.tsx). Kept free of React / DOM so it is
// unit-testable (`npm run test:unit`, node --test; relative imports only).
//
// The popup is a visitor-only nudge: never for a signed-in account, never for
// automation (navigator.webdriver: Lighthouse, Playwright, crawlers that drive
// a browser), and never again for 14 days once dismissed.

/** localStorage key holding the epoch-ms timestamp of the last dismissal. */
export const SIGNUP_PROMPT_STORAGE_KEY = "swarasa:signup-prompt:dismissed-at";

/** A dismissal is remembered this long (14 days). */
export const SIGNUP_PROMPT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Show after the visitor has been on the page this long... */
export const SIGNUP_PROMPT_DELAY_MS = 10_000;

/** ...or earlier, once they have scrolled this fraction of the page height. */
export const SIGNUP_PROMPT_SCROLL_THRESHOLD = 0.6;

/** Clock skew allowed before a stored "future" timestamp is treated as corrupt. */
const FUTURE_TOLERANCE_MS = 60 * 1000;

/**
 * Parse the stored value: a positive integer epoch-ms string. Anything else
 * (missing, empty, non-numeric, negative, fractional) is `null`, i.e. "never
 * dismissed", so a corrupt value can never hide the popup forever.
 */
export function parseDismissedAt(raw: string | null | undefined): number | null {
  if (typeof raw !== "string" || !/^\d{1,15}$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * True while a stored dismissal still suppresses the popup. A timestamp from
 * the future (beyond a minute of clock skew) is corrupt, not "dismissed".
 */
export function isDismissalActive(dismissedAt: number | null, now: number): boolean {
  if (dismissedAt === null) return false;
  if (dismissedAt > now + FUTURE_TOLERANCE_MS) return false;
  return now - dismissedAt < SIGNUP_PROMPT_TTL_MS;
}

export interface ShouldShowInput {
  signedIn: boolean;
  /** `navigator.webdriver === true`. */
  webdriver: boolean;
  /** Parsed stored dismissal, or `null` when missing/corrupt/storage unavailable. */
  dismissedAt: number | null;
  now: number;
  /**
   * Dismissed earlier in this page session (in-memory flag). This is the only
   * memory when storage is blocked: show at most once per page load.
   */
  dismissedThisSession?: boolean;
}

export function shouldShowSignupPrompt(input: ShouldShowInput): boolean {
  if (input.signedIn) return false;
  if (input.webdriver) return false;
  if (input.dismissedThisSession === true) return false;
  return !isDismissalActive(input.dismissedAt, input.now);
}

/**
 * Has the visitor scrolled "past ~60% of the page"? Measured as the bottom edge
 * of the viewport relative to the full document height. A page that does not
 * scroll at all never triggers this (the timer covers it).
 */
export function hasScrolledPastThreshold(
  scrollY: number,
  viewportHeight: number,
  documentHeight: number,
  threshold: number = SIGNUP_PROMPT_SCROLL_THRESHOLD
): boolean {
  if (!(documentHeight > 0) || !(viewportHeight > 0)) return false;
  if (documentHeight <= viewportHeight) return false;
  return (scrollY + viewportHeight) / documentHeight >= threshold;
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Is the focused element somewhere the visitor types? The popup is postponed
 * rather than yanking focus out of a field mid-keystroke.
 */
export function isTypingTarget(tagName: string | null | undefined, isContentEditable: boolean): boolean {
  if (isContentEditable) return true;
  return typeof tagName === "string" && TYPING_TAGS.has(tagName.toUpperCase());
}

/**
 * Focus-trap step: index of the focusable to move to when Tab (or Shift+Tab)
 * is pressed on `current` (-1 when focus is outside the list) among `count`
 * focusables. Wraps at both ends; `null` when there is nothing to focus.
 */
export function nextTrapIndex(current: number, count: number, shift: boolean): number | null {
  if (count <= 0) return null;
  if (current < 0 || current >= count) return shift ? count - 1 : 0;
  if (shift) return current === 0 ? count - 1 : current - 1;
  return current === count - 1 ? 0 : current + 1;
}
