// Server-only glue: turns the browser-supplied guard payload plus the
// incoming request's address into the headers a guarded backend call needs.
// Import ONLY from server actions / route handlers — `headers()` throws
// outside a request, which is exactly why the call is wrapped.
import { headers } from "next/headers";
import { buildGuardHeaders, firstForwardedIp } from "./guardLogic";

/** The visitor's address as the Next server saw it (a hint, see guardLogic). */
export function visitorIpFromRequest(): string | null {
  try {
    const incoming = headers();
    return firstForwardedIp(incoming.get("x-forwarded-for"), incoming.get("x-real-ip"));
  } catch {
    return null;
  }
}

/**
 * `X-Form-Token` / `X-Form-Trap` / `X-Visitor-IP` for a guarded backend call.
 * `payload` is whatever the client sent (untrusted; sanitised here).
 */
export function guardHeadersFor(payload: unknown): Record<string, string> {
  return buildGuardHeaders(payload, visitorIpFromRequest());
}
