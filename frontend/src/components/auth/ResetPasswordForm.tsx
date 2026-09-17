"use client";

// Step 2 of forgot/reset password (docs/PROJECT_PLAN.csv row 62): code +
// new password, via Cognito's confirmResetPassword(). Step 1 (request the
// code) is app/forgot-password + ForgotPasswordForm.tsx.
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmResetPassword } from "@aws-amplify/auth";
import { ensureAmplifyConfigured } from "@/lib/auth/amplifyClient";
import {
  resetPasswordSchema,
  type ResetPasswordFormValues,
} from "@/lib/validation/auth";
import { messageForAuthError } from "@/lib/auth/errorMessages";

type FieldErrors = Partial<Record<keyof ResetPasswordFormValues, string>>;

export default function ResetPasswordForm({
  initialEmail = "",
}: {
  initialEmail?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const parsed = resetPasswordSchema.safeParse({
      email,
      code,
      newPassword,
      confirmNewPassword,
    });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ResetPasswordFormValues;
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    try {
      ensureAmplifyConfigured();
      await confirmResetPassword({
        username: parsed.data.email,
        confirmationCode: parsed.data.code,
        newPassword: parsed.data.newPassword,
      });
      router.push("/login?reset=1");
    } catch (err) {
      setFormError(messageForAuthError(err, "reset-password"));
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
          htmlFor="code"
          className="text-sm font-medium text-brand-ink-muted"
        >
          Reset code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={Boolean(fieldErrors.code)}
          className="min-h-[44px] rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink placeholder:text-brand-placeholder focus:outline-none focus:ring-2 focus:ring-brand-accent"
          placeholder="123456"
        />
        {fieldErrors.code && (
          <p className="text-sm text-brand-closed">{fieldErrors.code}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="newPassword"
          className="text-sm font-medium text-brand-ink-muted"
        >
          New password
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          aria-invalid={Boolean(fieldErrors.newPassword)}
          aria-describedby="new-password-hint"
          className="min-h-[44px] rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink placeholder:text-brand-placeholder focus:outline-none focus:ring-2 focus:ring-brand-accent"
          placeholder="********"
        />
        <p id="new-password-hint" className="text-sm text-brand-ink-subtle">
          At least 8 characters, with an uppercase letter and a number.
        </p>
        {fieldErrors.newPassword && (
          <p className="text-sm text-brand-closed">
            {fieldErrors.newPassword}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="confirmNewPassword"
          className="text-sm font-medium text-brand-ink-muted"
        >
          Confirm new password
        </label>
        <input
          id="confirmNewPassword"
          name="confirmNewPassword"
          type="password"
          autoComplete="new-password"
          value={confirmNewPassword}
          onChange={(e) => setConfirmNewPassword(e.target.value)}
          aria-invalid={Boolean(fieldErrors.confirmNewPassword)}
          className="min-h-[44px] rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink placeholder:text-brand-placeholder focus:outline-none focus:ring-2 focus:ring-brand-accent"
          placeholder="********"
        />
        {fieldErrors.confirmNewPassword && (
          <p className="text-sm text-brand-closed">
            {fieldErrors.confirmNewPassword}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Resetting…" : "Reset Password"}
      </button>

      <p className="text-center text-sm text-brand-ink-muted">
        <Link
          href="/login"
          className="font-medium text-brand-accent transition hover:text-brand-accent-hover"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
