// Pure logic for the form guard (honeypot + signed form token). No React, no
// Next, no network: everything here is unit-tested with `node --test`
// (guardLogic.test.ts). The authoritative checks live in the BACKEND
// (docs/API_CONTRACTS.md "Form guard"); this module only decides how the
// browser and the Next server cooperate with them.

/** Every form that gets a token. Mirrors the backend's `FormName`. */
export const FORM_NAMES = [
  "report",
  "claim",
  "contact_admin",
  "catering_request",
  "brand_create",
  "signup",
  "forgot",
  "reset",
  "confirm",
  "login",
] as const;
export type FormName = (typeof FORM_NAMES)[number];

export function isFormName(value: unknown): value is FormName {
  return typeof value === "string" && (FORM_NAMES as readonly string[]).includes(value);
}

/**
 * Name of the honeypot input. Deliberately NOT `email` / `phone` / `name` /
 * `website` / anything a browser or password manager would autofill, and
 * not "honeypot"-looking either.
 */
export const TRAP_FIELD_NAME = "referral_code2";

/** What the browser hands the server action alongside the form values. */
export interface GuardPayload {
  token: string | null;
  trap: string;
}

/** A humans-never-fill-it field: any non-blank value means a bot. */
export function isTrapTripped(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Extra wait applied on top of the server's minimum so clock rounding on the
 * server (whole seconds) can never reject an honest, patient submit. */
export const SUBMIT_MARGIN_MS = 750;

/**
 * Milliseconds still to wait before a token may be submitted. The client
 * measures from when it RECEIVED the token, which is never earlier than when
 * the server issued it, so waiting out the server's minimum from here is
 * always enough. 0 = submit now.
 */
export function msUntilSubmittable(
  receivedAtMs: number,
  nowMs: number,
  minSeconds: number
): number {
  const ready = receivedAtMs + Math.max(0, minSeconds) * 1000 + SUBMIT_MARGIN_MS;
  return Math.max(0, ready - nowMs);
}

/** Tokens live 2 h server-side; refresh well before that (page left open). */
export const TOKEN_REFRESH_AFTER_MS = 90 * 60 * 1000;

export function tokenIsStale(receivedAtMs: number, nowMs: number): boolean {
  return nowMs - receivedAtMs >= TOKEN_REFRESH_AFTER_MS;
}

export interface TokenResponse {
  token: string;
  minSeconds: number;
}

/** Validates the `{ token, min_seconds }` body of `POST /forms/token`. */
export function parseTokenResponse(body: unknown): TokenResponse | null {
  if (!body || typeof body !== "object") return null;
  const { token, min_seconds: minSeconds } = body as Record<string, unknown>;
  if (typeof token !== "string" || token.length === 0 || token.length > 200) return null;
  if (typeof minSeconds !== "number" || !Number.isFinite(minSeconds)) return null;
  return { token, minSeconds: Math.min(30, Math.max(0, Math.floor(minSeconds))) };
}

/**
 * The visitor's address as seen by the Next server: the FIRST hop of
 * `x-forwarded-for` (the original client), else `x-real-ip`. Only a HINT for
 * the backend's per-visitor limit -- never an identity, and never stored raw
 * (the backend hashes it).
 */
export function firstForwardedIp(
  forwardedFor: string | null | undefined,
  realIp: string | null | undefined
): string | null {
  const first = forwardedFor?.split(",")[0]?.trim();
  const candidate = first || realIp?.trim() || "";
  if (!candidate || candidate.length > 64 || /[\s\u0000-\u001f]/.test(candidate)) return null;
  return candidate;
}

/** Headers the Next SERVER attaches to a guarded backend call. Server-to-server
 * only -- never sent from the browser. Tolerates a garbage payload. */
export function buildGuardHeaders(
  payload: unknown,
  visitorIp: string | null
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (payload && typeof payload === "object") {
    const { token, trap } = payload as Record<string, unknown>;
    if (typeof token === "string" && token.length > 0 && token.length <= 200) {
      headers["X-Form-Token"] = token;
    }
    if (isTrapTripped(trap)) {
      headers["X-Form-Trap"] = String(trap).trim().slice(0, 200);
    }
  }
  if (visitorIp) headers["X-Visitor-IP"] = visitorIp;
  return headers;
}

export const GUARD_FAILED_MESSAGE =
  "We couldn't verify that submission. Please try again.";
export const GUARD_RATE_LIMITED_MESSAGE =
  "You've done that a few times in a short while. Please wait a few minutes and try again.";

/** True when the backend rejected the guard itself (not the form content). */
export function isGuardFailure(status: number, code?: string | null): boolean {
  return (status === 400 && code === "form_check_failed") || (status === 429 && code === "rate_limited");
}

/**
 * Friendly text for a guard rejection, or `null` when the error is not one
 * (so the caller keeps its own mapping). Same text for every reason: the
 * backend deliberately does not say why.
 */
export function guardErrorMessage(status: number, code?: string | null): string | null {
  if (!isGuardFailure(status, code)) return null;
  return status === 429 ? GUARD_RATE_LIMITED_MESSAGE : GUARD_FAILED_MESSAGE;
}
