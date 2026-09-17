"use client";

// Step 1 of forgot/reset password (docs/PROJECT_PLAN.csv row 62): request a
// reset code by email via Cognito's resetPassword(). Step 2 (code + new
// password) is app/forgot-password/confirm + ResetPasswordForm.tsx.
//
// Cognito's app client has `prevent_user_existence_errors = "ENABLED"`
// (infra/modules/cognito/main.tf), so resetPassword() succeeds the same way
// whether or not the email is registered — the success copy below is
// worded accordingly, never confirming or denying an account exists.
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resetPassword } from "@aws-amplify/auth";
import { ensureAmplifyConfigured } from "@/lib/auth/amplifyClient";
import {
  forgotPasswordRequestSchema,
  type ForgotPasswordRequestValues,
} from "@/lib/validation/auth";
import { messageForAuthError } from "@/lib/auth/errorMessages";

type FieldErrors = Partial<Record<keyof ForgotPasswordRequestValues, string>>;

export default function ForgotPasswordForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const parsed = forgotPasswordRequestSchema.safeParse({ email });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ForgotPasswordRequestValues;
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    try {
      ensureAmplifyConfigured();
      await resetPassword({ username: parsed.data.email });
      router.push(
        `/forgot-password/confirm?email=${encodeURIComponent(parsed.data.email)}`
      );
    } catch (err) {
      setFormError(messageForAuthError(err, "forgot-password"));
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

      <button
        type="submit"
        disabled={submitting}
        className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Sending…" : "Send Reset Code"}
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
