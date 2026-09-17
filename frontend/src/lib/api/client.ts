// Shared fetch wrapper for every typed API function in /lib/api/.
// Nothing outside this file (and the typed functions built on it) should
// call fetch() directly — see frontend/CLAUDE.md "NEVER fetch() inline in
// a component".
//
// The backend API URL is never hardcoded — always read from the
// NEXT_PUBLIC_API_URL env var (root CLAUDE.md "AWS Best Practices" /
// frontend/CLAUDE.md "Environment Variables").

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL;

/**
 * Bound on how long any single backend call is allowed to hang before
 * `apiFetch` gives up and surfaces a normal, catchable `ApiError` instead.
 *
 * Added 2026-09-17 (see PR #73): without this, a backend call that never
 * resolves (connection accepted but no response — not a fast
 * connection-refused, which `fetch` already rejects quickly) hangs the
 * `await` forever. In a Server Component like
 * `app/portal/dashboard/page.tsx`, that hangs the entire SSR render until
 * the platform's own Lambda/edge-function timeout kills it — which surfaces
 * to the browser as a bare 504 with no body, bypassing every try/catch the
 * page already has around its `apiFetch` calls (`ApiError` is only ever
 * thrown for a *settled* fetch; a fetch that never settles doesn't throw at
 * all, it just doesn't return). That, in turn, is what left
 * `components/auth/LoginForm.tsx` stuck showing "Signing in…" forever after
 * a fully successful sign-in: `router.push()`'s soft navigation to the
 * landing page never got a response to navigate to. This timeout makes a
 * hung backend fail the same way a down backend already does — fast, and
 * through the existing `ApiError` → page-level error-message path — rather
 * than a special, unhandled failure mode.
 *
 * Raised from 10s to 25s the same day, after live testing against the
 * deployed dev backend: Aurora Serverless v2 is intentionally configured
 * with `min_capacity = 0` (root CLAUDE.md "NEVER remove Aurora
 * min_capacity = 0" — a deliberate cost guardrail, not something to
 * relitigate here) and auto-pauses after 5 minutes idle
 * (`SecondsUntilAutoPause: 300`, confirmed via `aws rds
 * describe-db-clusters`). Resuming from a full pause was observed taking
 * ~14-16s for successful requests (CloudWatch logs, swarasa-api-dev), which
 * the original 10s bound was killing as false-positive timeouts before the
 * backend ever got a chance to answer. 25s keeps meaningful margin under
 * the backend Lambda's own 30s function timeout (a hung call still fails
 * here first, with a real ApiError, rather than silently riding out
 * Lambda's timeout) while comfortably covering the observed cold-start
 * latency. A scheduled keep-warm ping is a further option but changes the
 * cost/latency tradeoff `min_capacity = 0` was chosen for — flagged to the
 * human rather than added silently.
 */
const API_FETCH_TIMEOUT_MS = 25_000;

/** Thrown by apiFetch on any non-2xx response, or when a request times out. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface ApiFetchOptions {
  /**
   * Cognito access token for routes that require auth (docs/API_CONTRACTS.md
   * "Auth model reference"). Public GET endpoints omit this. Callers get the
   * token from `getServerSession()` (server components) or their own
   * client-side session state — this file has no opinion on where it comes
   * from, only that it's attached when present.
   */
  accessToken?: string | null;
  /** Next.js data cache revalidation window, in seconds, for GET requests. */
  revalidateSeconds?: number;
}

/**
 * Builds a query string from a flat params object. Array values (e.g.
 * cuisine[], dietary[]) are repeated as multiple same-name params, matching
 * FastAPI's default List[str] query parsing.
 */
export function toQueryString(
  params: Record<string, string | number | boolean | string[] | undefined | null>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item);
    } else {
      search.append(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "detail" in body) {
      const detail = (body as { detail: unknown }).detail;
      if (typeof detail === "string") return detail;
    }
  } catch {
    // Response body wasn't JSON (or was empty) — fall through to the
    // generic message. Never surface raw stack/body details to the UI
    // (root CLAUDE.md "NEVER expose internal stack details").
  }
  return `Request failed with status ${res.status}`;
}

/**
 * Core request helper. Every function in /lib/api/*.ts calls through this
 * — it owns the base URL, auth header, JSON encode/decode, and error
 * normalization so individual endpoint functions stay one-liners.
 */
export async function apiFetch<TResponse>(
  path: string,
  init: RequestInit = {},
  options: ApiFetchOptions = {}
): Promise<TResponse> {
  if (!API_BASE_URL) {
    throw new ApiError(
      500,
      "NEXT_PUBLIC_API_URL is not configured — set it in the environment before calling the API."
    );
  }

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (options.accessToken) {
    headers.set("Authorization", `Bearer ${options.accessToken}`);
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(),
    API_FETCH_TIMEOUT_MS
  );

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: timeoutController.signal,
      next:
        options.revalidateSeconds !== undefined
          ? { revalidate: options.revalidateSeconds }
          : undefined,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError(
        504,
        "The restaurant service is starting up and taking longer than usual. Please wait a moment and try again."
      );
    }
    throw new ApiError(
      502,
      "Could not reach the restaurant service. Please try again."
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new ApiError(res.status, await extractErrorMessage(res));
  }

  if (res.status === 204) {
    return undefined as TResponse;
  }

  return (await res.json()) as TResponse;
}
