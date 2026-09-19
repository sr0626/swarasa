"use client";

// Account-activation step after sign-up (docs/PROJECT_PLAN.csv row 61):
// Cognito requires the emailed verification code before the account is
// usable (auto_verified_attributes = ["email"] in
// infra/modules/cognito/main.tf). This is that code-entry page, plus a
// resend-code affordance — both explicitly called out in the task.
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { confirmSignUp, resendSignUpCode } from "@aws-amplify/auth";
import { ensureAmplifyConfigured } from "@/lib/auth/amplifyClient";
import {
  confirmSignUpSchema,
  type ConfirmSignUpFormValues,
} from "@/lib/validation/auth";
import { withNext } from "@/lib/auth/safeNext";
import { messageForAuthError } from "@/lib/auth/errorMessages";

type FieldErrors = Partial<Record<keyof ConfirmSignUpFormValues, string>>;

export default function ConfirmSignUpForm({
  initialEmail = "",
  nextPath = null,
}: {
  /** Already-validated same-site path (safeNextPath) to resume after sign-in. */
  nextPath?: string | null;
  initialEmail?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setResendMessage(null);

    const parsed = confirmSignUpSchema.safeParse({ email, code });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ConfirmSignUpFormValues;
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    try {
      ensureAmplifyConfigured();
      const { isSignUpComplete } = await confirmSignUp({
        username: parsed.data.email,
        confirmationCode: parsed.data.code,
      });

      if (isSignUpComplete) {
        router.push(withNext("/login?confirmed=1", nextPath));
        return;
      }

      setFormError(
        "Your account needs an extra verification step we don't support yet. Please contact support."
      );
      setSubmitting(false);
    } catch (err) {
      setFormError(messageForAuthError(err, "confirm-sign-up"));
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setFormError(null);
    setResendMessage(null);

    const emailCheck = confirmSignUpSchema.shape.email.safeParse(email);
    if (!emailCheck.success) {
      setFieldErrors((prev) => ({
        ...prev,
        email: emailCheck.error.issues[0]?.message,
      }));
      return;
    }

    setResending(true);
    try {
      ensureAmplifyConfigured();
      await resendSignUpCode({ username: emailCheck.data });
      setResendMessage("A new code has been sent to your email.");
    } catch (err) {
      setFormError(messageForAuthError(err, "resend-code"));
    } finally {
      setResending(false);
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
      {resendMessage && (
        <p
          role="status"
          className="rounded-brand-control bg-brand-success-bg px-3 py-2 text-sm text-brand-success"
        >
          {resendMessage}
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
          Verification code
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

      <button
        type="submit"
        disabled={submitting}
        className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Confirming…" : "Confirm Account"}
      </button>

      <button
        type="button"
        onClick={handleResend}
        disabled={resending}
        className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-brand-control border border-brand-border bg-white px-6 text-sm font-semibold text-brand-ink transition hover:border-brand-ink-subtle disabled:cursor-not-allowed disabled:opacity-60"
      >
        {resending ? "Sending…" : "Resend code"}
      </button>
    </form>
  );
}
