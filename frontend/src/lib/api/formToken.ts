// Browser-side fetch of a form token through this app's own route handler
// (app/api/form-token/route.ts). Same-origin, so it carries no API URL and no
// secret. Resolves `null` on any failure — the caller must stay usable.
import {
  parseTokenResponse,
  type FormName,
  type TokenResponse,
} from "@/lib/formGuard/guardLogic";

export const FORM_TOKEN_ENDPOINT = "/api/form-token";

export async function requestFormToken(form: FormName): Promise<TokenResponse | null> {
  try {
    const res = await fetch(FORM_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ form }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return parseTokenResponse(await res.json());
  } catch {
    return null;
  }
}
