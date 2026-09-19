"use client";

// Real Cognito sign-in form for the "Spice Market" login page
// (app/login/page.tsx).
//
// JUDGMENT CALL (flagged in final report): lib/auth/config.ts only ever
// defines `userPoolId`/`clientId` — no hostedUIUrl, Cognito domain, or
// redirect URI, and infra/modules/cognito/main.tf never provisions a
// Hosted UI domain either. frontend/CLAUDE.md's Stack section names
// "amazon-cognito-identity-js or @aws-amplify/auth" as the intended
// mechanism, and @aws-amplify/auth is the one already pinned in
// package.json. So this is the client-side email/password form via
// @aws-amplify/auth, not a Hosted UI redirect.
//
// Tokens never touch localStorage — see lib/auth/amplifyClient.ts's
// in-memory KeyValueStorage override. After signIn() succeeds, the access
// token is handed to POST /api/auth/session (app/api/auth/session/route.ts)
// which verifies it and sets the real httpOnly session cookie
// getServerSession()/requireSession() read; only then do we navigate to a
// role-based landing page.
//
// "Keep me signed in" (docs/PROJECT_PLAN.csv row 63): the checkbox below
// tells POST /api/auth/session to mint a longer-lived cookie (see that
// route and lib/auth/sessionConstants.ts's REMEMBER_ME_MAX_AGE_SECONDS) AND
// starts lib/auth/sessionKeepAlive.ts's silent-refresh loop — read that
// file's header for exactly what it does and its documented gap (a longer
// cookie alone does not keep anyone signed in for 14 days, since the access
// token inside it still expires in 1 hour; the keep-alive loop is what
// actually refreshes it, for as long as this tab stays open).
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn, fetchAuthSession } from "@aws-amplify/auth";
import { ensureAmplifyConfigured } from "@/lib/auth/amplifyClient";
import { startSessionKeepAlive } from "@/lib/auth/sessionKeepAlive";
import { signInSchema, type SignInFormValues } from "@/lib/validation/auth";
import { withNext, pathAllowedForRole } from "@/lib/auth/safeNext";
import { messageForAuthError, messageForNextStep } from "@/lib/auth/errorMessages";
import { PasswordInput } from "@/components/ui/PasswordInput";
import type { UserRole } from "@/types/auth";

/**
 * Where each pool group lands after sign-in. Owner/manager share the
 * portal dashboard (frontend/CLAUDE.md's "Auth-gated portal pages"
 * pattern); admin has its own section; a registered_user has no gated
 * area yet in Phase 1, so it goes back to the homepage.
 */
const ROLE_LANDING: Record<UserRole, string> = {
  owner: "/portal/dashboard",
  manager: "/portal/dashboard",
  admin: "/admin/listings",
  registered_user: "/",
};

type FieldErrors = Partial<Record<keyof SignInFormValues, string>>;

export default function LoginForm({
  nextPath = null,
}: {
  /** Already-validated same-site path (safeNextPath) to land on after sign-in. */
  nextPath?: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof SignInFormValues;
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    try {
      ensureAmplifyConfigured();
      const { isSignedIn, nextStep } = await signIn({
        username: parsed.data.email,
        password: parsed.data.password,
      });

      if (!isSignedIn) {
        setFormError(messageForNextStep(nextStep.signInStep));
        setSubmitting(false);
        return;
      }

      const authSession = await fetchAuthSession();
      // Deliberately the ID token, not the access token (fixed 2026-09-18 —
      // was accessToken, a real production bug): a Cognito access token
      // does not carry an `email` claim by default (it's an authorization
      // token, not an identity token), but auth_service's lazy
      // owner_account provisioning (backend/app/services/auth_service.py)
      // requires one -- every real owner hit "An email claim is required
      // to provision an owner account" on first login. The ID token
      // carries the same cognito:groups claim this backend already reads
      // for role extraction, plus email, sub, everything needed -- no
      // Cognito-side reconfiguration required. This field/cookie/prop is
      // still named "accessToken" throughout the codebase (route.ts,
      // sessionKeepAlive.ts, ApiFetchOptions) -- a broader rename is a
      // follow-up, not bundled into this urgent fix.
      const accessToken = authSession.tokens?.idToken?.toString();
      if (!accessToken) {
        setFormError(
          "Sign-in succeeded but no session token was returned. Please try again."
        );
        setSubmitting(false);
        return;
      }

      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, rememberMe }),
      });

      if (!res.ok) {
        setFormError("Could not establish your session. Please try again.");
        setSubmitting(false);
        return;
      }

      const { role } = (await res.json()) as { role: UserRole };
      if (rememberMe) {
        startSessionKeepAlive();
      }
      // `nextPath` only if this role can use it (a diner signing in from an
      // owner-only link goes to the normal landing, not a guard bounce).
      router.push(
        nextPath && pathAllowedForRole(nextPath, role) ? nextPath : (ROLE_LANDING[role] ?? "/")
      );
      router.refresh();
    } catch (err) {
      setFormError(messageForAuthError(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {formError && (
        <p
          role="alert"
          className="rounded-brand-control bg-brand-closed-bg px-3 py-2 text-sm text-brand-closed"
        >
          {formError}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="email"
          className="text-sm font-medium text-brand-ink-muted"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(fieldErrors.email)}
          className="min-h-[44px] rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink placeholder:text-brand-placeholder focus:outline-none focus:ring-2 focus:ring-brand-accent"
          placeholder="you@example.com"
        />
        {fieldErrors.email && (
          <p className="text-sm text-brand-closed">{fieldErrors.email}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="password"
          className="text-sm font-medium text-brand-ink-muted"
        >
          Password
        </label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={Boolean(fieldErrors.password)}
          className="min-h-[44px] w-full rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink placeholder:text-brand-placeholder focus:outline-none focus:ring-2 focus:ring-brand-accent"
          placeholder="********"
        />
        {fieldErrors.password && (
          <p className="text-sm text-brand-closed">{fieldErrors.password}</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-brand-ink-muted">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 accent-brand-accent"
          />
          Keep me signed in
        </label>
        <Link
          href="/forgot-password"
          className="text-sm font-medium text-brand-accent transition hover:text-brand-accent-hover"
        >
          Forgot your password?
        </Link>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Sign In"}
      </button>

      <p className="text-center text-sm text-brand-ink-muted">
        New here?{" "}
        <Link
          href={withNext("/signup", nextPath)}
          className="font-medium text-brand-accent transition hover:text-brand-accent-hover"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
