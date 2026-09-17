"use client";

// Client-side Amplify bootstrap for the sign-in form only
// (components/auth/LoginForm.tsx). Deliberately NOT re-exported from
// lib/auth/index.ts's barrel — everything else in lib/auth/ is server-only
// (session.ts/guards.ts use `next/headers`), and this file configures a
// browser-only Amplify singleton, so keeping it off the barrel means no
// Server Component can accidentally pull it in.
//
// @aws-amplify/auth's default Cognito token store falls back to
// `window.localStorage` when available (see its own tokenProvider.mjs doc
// comment: "It stores the tokens in `window.localStorage` if available").
// That would violate frontend/CLAUDE.md's "NEVER store auth tokens in
// localStorage — use Cognito's secure cookie approach", so this swaps in
// an in-memory store before any sign-in call: tokens live only for the
// instant between `signIn()`/`fetchAuthSession()` and handing the access
// token to POST /api/auth/session, which sets the real httpOnly cookie.
// Nothing Amplify touches here ever reaches disk.
import {
  Amplify,
  type AuthConfig,
  type KeyValueStorageInterface,
} from "@aws-amplify/core";
import { cognitoUserPoolsTokenProvider } from "@aws-amplify/auth/cognito";
import { assertCognitoConfig } from "./config";

class InMemoryKeyValueStorage implements KeyValueStorageInterface {
  private readonly store = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

let configured = false;

/**
 * Configures Amplify's Cognito user pool once for this browser tab. Safe
 * to call on every sign-in attempt — a no-op after the first call.
 *
 * BUG FIX (2026-09-16): `Amplify.configure()` alone is NOT enough when the
 * app depends directly on the modular `@aws-amplify/auth` /
 * `@aws-amplify/core` packages instead of the public `aws-amplify` package
 * (`@aws-amplify/auth`'s own README says "INTERNAL USE ONLY... use
 * aws-amplify" — this app uses it directly anyway, per package.json).
 * `Amplify.configure()` only stores the resource config that
 * `Amplify.getConfig()` returns; the public `aws-amplify` package is what
 * normally also wires `cognitoUserPoolsTokenProvider` into
 * `Amplify`'s auth options and calls
 * `cognitoUserPoolsTokenProvider.setAuthConfig(...)` as a side effect.
 * Skipping that step left `DefaultTokenStore`/`TokenOrchestrator`'s
 * internal `authConfig` permanently `undefined`, so the very first call
 * that reads it — `getAuthKeys()`, invoked from `getDeviceMetadata()`
 * partway through the SRP password-verifier step of `signIn()` — threw
 * `AuthUserPoolException: Auth UserPool not configured.` before ever
 * reaching the network. The first InitiateAuth (SRP_A) call looked fine
 * because it only reads `Amplify.getConfig()` directly, a different,
 * unaffected path. Confirmed by reading
 * node_modules/@aws-amplify/auth/dist/esm/providers/cognito/utils/signInHelpers.mjs
 * (`handlePasswordVerifierChallenge`) and
 * node_modules/@aws-amplify/core/dist/esm/singleton/Auth/utils/index.mjs
 * (`assertTokenProviderConfig`, message matches exactly) against the pinned
 * @aws-amplify/auth@6.6.2 / @aws-amplify/core@6.6.0. `fetchAuthSession()`
 * has the same gap on the `libraryOptions.Auth.tokenProvider` side, which
 * is why it's wired via `Amplify.configure()`'s second argument below.
 */
export function ensureAmplifyConfigured(): void {
  if (configured) return;

  const { userPoolId, clientId } = assertCognitoConfig();

  cognitoUserPoolsTokenProvider.setKeyValueStorage(
    new InMemoryKeyValueStorage()
  );

  const authConfig: AuthConfig = {
    Cognito: {
      userPoolId,
      userPoolClientId: clientId,
    },
  };

  Amplify.configure(
    { Auth: authConfig },
    { Auth: { tokenProvider: cognitoUserPoolsTokenProvider } }
  );

  // Explicitly propagate the config to the token provider's internal store —
  // see the bug-fix note above. This is the step the public `aws-amplify`
  // package would otherwise perform automatically.
  cognitoUserPoolsTokenProvider.setAuthConfig(authConfig);

  configured = true;
}
