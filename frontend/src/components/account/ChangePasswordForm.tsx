"use client";

// Change-password form for app/account/security/page.tsx
// (docs/PROJECT_PLAN.csv "Signed-in account dropdown in site header" — the
// Security menu item, components/home/AccountMenu.tsx). No dedicated
// password-change UI existed anywhere before this task.
//
// JUDGMENT CALL (flagged in this PR's description): Cognito's
// `updatePassword({ oldPassword, newPassword })` operates on Amplify's OWN
// client-side session, not the httpOnly `rp_access_token` cookie this app's
// server-side auth (lib/auth/session.ts) actually relies on. Those are two
// separate things — see lib/auth/amplifyClient.ts's in-memory
// `KeyValueStorage`: Amplify never persists tokens across a reload/new tab,
// by design (root CLAUDE.md "NEVER store auth tokens in localStorage"). So
// a visitor who reaches this page with a perfectly valid server-side
// session (cookie still good) MAY have no live Amplify session in THIS
// tab/pageload — e.g. they closed and reopened the tab, or followed a link
// here instead of arriving straight from LoginForm.tsx. `updatePassword()`
// would then throw `UserUnAuthenticatedException`.
// Handled by checking `fetchAuthSession()` for a usable access token
// on mount before rendering the form at all — if there's nothing there, we
// show a clear "sign in again" prompt instead of letting the form fail
// confusingly after the user has typed both passwords in. Closing this gap
// for real (e.g. so navigating here always works no matter how the tab got
// its cookie) needs the same second-httpOnly-cookie/server-side-refresh
// design flagged as a follow-up in sessionKeepAlive.ts's header comment —
// out of scope for this change.
import { useEffect, useState, type FormEvent } from "react";
import { fetchAuthSession, updatePassword } from "@aws-amplify/auth";
import { ensureAmplifyConfigured } from "@/lib/auth/amplifyClient";
import {
  changePasswordSchema,
  type ChangePasswordFormValues,
} from "@/lib/validation/auth";
import { messageForAuthError } from "@/lib/auth/errorMessages";
import InfoPanel from "@/components/ui/InfoPanel";

type FieldErrors = Partial<Record<keyof ChangePasswordFormValues, string>>;
type SessionCheck = "checking" | "ready" | "unavailable";

const inputClass =
  "min-h-[44px] rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink placeholder:text-brand-placeholder focus:outline-none focus:ring-2 focus:ring-brand-accent";
const labelClass = "text-sm font-medium text-brand-ink-muted";

export default function ChangePasswordForm() {
  const [sessionCheck, setSessionCheck] = useState<SessionCheck>("checking");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function checkSession() {
      try {
        ensureAmplifyConfigured();
        const session = await fetchAuthSession();
        if (cancelled) return;
        setSessionCheck(session.tokens?.accessToken ? "ready" : "unavailable");
      } catch {
        if (!cancelled) setSessionCheck("unavailable");
      }
    }
    void checkSession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setSaved(false);

    const parsed = changePasswordSchema.safeParse({
      currentPassword,
      newPassword,
      confirmNewPassword,
    });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ChangePasswordFormValues;
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    try {
      ensureAmplifyConfigured();
      await updatePassword({
        oldPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
      });
      setSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (err) {
      setFormError(messageForAuthError(err, "change-password"));
    } finally {
      setSubmitting(false);
    }
  }

  if (sessionCheck === "checking") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-brand-card border border-brand-border bg-white p-5 text-sm text-brand-ink-muted shadow-brand-card sm:p-6"
      >
        Checking your session…
      </div>
    );
  }

  if (sessionCheck === "unavailable") {
    return (
      <InfoPanel
        title="Please sign in again to change your password"
        body="For security, changing your password needs a fresh sign-in in this browser tab. Sign in again, then come back to this page."
      />
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
      noValidate
    >
      {formError && (
        <p
          role="alert"
          className="rounded-brand-control bg-brand-closed-bg px-3 py-2 text-sm text-brand-closed"
        >
          {formError}
        </p>
      )}
      {saved && !formError && (
        <p className="rounded-brand-control bg-brand-success-bg px-3 py-2.5 text-sm text-brand-success">
          Password changed.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="currentPassword" className={labelClass}>
          Current password
        </label>
        <input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          aria-invalid={Boolean(fieldErrors.currentPassword)}
          className={inputClass}
        />
        {fieldErrors.currentPassword && (
          <p className="text-sm text-brand-closed">{fieldErrors.currentPassword}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="newPassword" className={labelClass}>
          New password
        </label>
        <input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          aria-invalid={Boolean(fieldErrors.newPassword)}
          className={inputClass}
        />
        {fieldErrors.newPassword && (
          <p className="text-sm text-brand-closed">{fieldErrors.newPassword}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirmNewPassword" className={labelClass}>
          Confirm new password
        </label>
        <input
          id="confirmNewPassword"
          type="password"
          autoComplete="new-password"
          value={confirmNewPassword}
          onChange={(e) => setConfirmNewPassword(e.target.value)}
          aria-invalid={Boolean(fieldErrors.confirmNewPassword)}
          className={inputClass}
        />
        {fieldErrors.confirmNewPassword && (
          <p className="text-sm text-brand-closed">{fieldErrors.confirmNewPassword}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {submitting ? "Changing password…" : "Change password"}
      </button>
    </form>
  );
}
