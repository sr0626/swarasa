"use client";

// Accept button for a signed-in invitee (diner or manager account) on
// /invite/[token]. The server action runs the same validation as a normal
// manager assignment; failures are deliberately generic (the API never says
// whether the link, the email or a rule was the problem).
//
// A diner who accepts is added to the Cognito `manager` group server-side, but
// the session token they hold was issued before that and still says "diner" —
// so after success we ask them to sign in again, with a one-tap button that
// clears the session cookie (same clean-up as the account menu's Logout) and
// goes to /login.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "@aws-amplify/auth";
import { acceptManagerInviteAction } from "@/app/invite/[token]/actions";
import { ensureAmplifyConfigured } from "@/lib/auth/amplifyClient";
import { stopSessionKeepAlive } from "@/lib/auth/sessionKeepAlive";
import { withNext } from "@/lib/auth/safeNext";
import type { ManagerInviteAccepted } from "@/types/managerInvite";

const primaryButton =
  "flex min-h-[44px] w-full items-center justify-center rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60";

export default function InviteAcceptance({ token }: { token: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<ManagerInviteAccepted | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  async function handleAccept() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await acceptManagerInviteAction(token);
      if (result.ok) setAccepted(result.data);
      else setError(result.error);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignInAgain() {
    if (signingOut) return;
    setSigningOut(true);
    stopSessionKeepAlive();
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
    } catch {
      // Best effort — the redirect below still lands on the sign-in page.
    }
    try {
      ensureAmplifyConfigured();
      await signOut();
    } catch {
      // No in-memory Amplify session to clear; the cookie clear is what matters.
    }
    router.push(withNext("/login", "/account"));
    router.refresh();
  }

  if (accepted) {
    const name = accepted.location_name
      ? `${accepted.brand_name} — ${accepted.location_name}`
      : accepted.brand_name;
    return (
      <div role="status" className="flex flex-col gap-4">
        <p className="rounded-brand-control bg-brand-success-bg px-3 py-2 text-sm text-brand-success">
          You&apos;re now a manager of <strong>{name}</strong>.
        </p>
        {accepted.sign_in_again ? (
          <>
            <p className="text-sm text-brand-ink-muted">
              Sign in again to open your manager console — your current session was
              started before you became a manager.
            </p>
            <button type="button" onClick={handleSignInAgain} disabled={signingOut} className={primaryButton}>
              {signingOut ? "Signing out..." : "Sign in again"}
            </button>
          </>
        ) : (
          <Link href="/account" className={primaryButton}>
            Go to my manager console
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="rounded-brand-control bg-brand-closed-bg px-3 py-2 text-sm text-brand-closed">
          {error}
        </p>
      )}
      <button type="button" onClick={handleAccept} disabled={submitting} className={primaryButton}>
        {submitting ? "Accepting..." : "Accept invitation"}
      </button>
    </div>
  );
}
