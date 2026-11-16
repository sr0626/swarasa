// Typed client for the backend's form guard endpoints — docs/API_CONTRACTS.md
// "Form guard". SERVER-SIDE only (route handler / server actions): the Next
// server is the caller, so it also forwards the visitor's address in
// `X-Visitor-IP` (the backend only sees Amplify's). Browsers use
// lib/api/formToken.ts, which goes through this app's own /api/form-token.
import { apiFetch } from "./client";
import {
  parseTokenResponse,
  type FormName,
  type GuardPayload,
  type TokenResponse,
} from "@/lib/formGuard/guardLogic";

/** POST /forms/token — PUBLIC. `null` if the backend answered something unusable. */
export async function issueFormToken(
  form: FormName,
  headers: Record<string, string>
): Promise<TokenResponse | null> {
  const body = await apiFetch<unknown>(
    "/forms/token",
    { method: "POST", body: JSON.stringify({ form }), headers, cache: "no-store" },
    { timeoutMs: 8_000 }
  );
  return parseTokenResponse(body);
}

/** POST /forms/verify — PUBLIC. 204 on success; ApiError (400/429) otherwise. */
export async function verifyFormToken(
  form: FormName,
  payload: GuardPayload,
  headers: Record<string, string>
): Promise<void> {
  await apiFetch<void>(
    "/forms/verify",
    {
      method: "POST",
      body: JSON.stringify({ form, token: payload.token ?? "", trap: payload.trap }),
      headers,
      cache: "no-store",
    },
    { timeoutMs: 6_000 }
  );
}
