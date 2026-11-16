"use server";

// Server Action behind the gate for flows the browser runs against Cognito
// directly (sign-up, confirm, forgot/reset password, sign-in): the browser
// calls this FIRST, and only proceeds to Cognito when it answers `ok`.
//
// HONEST LIMIT: a caller who talks to Cognito's public API directly never
// passes through here. This stops scripted use of OUR pages only; covering the
// Cognito endpoint itself needs AWS WAF ACFP / Cognito advanced security (a
// later decision, docs/DECISIONS.md).
//
// Fails OPEN when the backend is unreachable or errors (5xx/timeout): these
// flows do not depend on our API, and an API outage must never lock people
// out of sign-in. It fails CLOSED only on the backend's explicit guard
// rejection (400 `form_check_failed` / 429 `rate_limited`).
import { ApiError } from "@/lib/api/client";
import { verifyFormToken } from "@/lib/api/forms";
import { guardHeadersFor } from "@/lib/formGuard/server";
import {
  guardErrorMessage,
  isFormName,
  type GuardPayload,
} from "@/lib/formGuard/guardLogic";

export type GateResult = { ok: true } | { ok: false; error: string };

export async function verifyFormGateAction(
  form: unknown,
  payload: unknown
): Promise<GateResult> {
  if (!isFormName(form)) return { ok: false, error: "Please try again." };
  const raw = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const clean: GuardPayload = {
    token: typeof raw.token === "string" ? raw.token : null,
    trap: typeof raw.trap === "string" ? raw.trap : "",
  };
  try {
    await verifyFormToken(form, clean, guardHeadersFor(null));
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const message = guardErrorMessage(error.status, error.code);
      if (message) return { ok: false, error: message };
    }
    return { ok: true };
  }
}
