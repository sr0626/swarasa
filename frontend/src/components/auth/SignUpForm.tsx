"use client";

// Self-service sign-up (docs/PROJECT_PLAN.csv row 61 — "Owner/Customer
// self-service sign-up + account activation"), scoped to exactly two roles:
//
//   - registered_user ("I'm a diner") — read-only + follow + deals, the
//     platform's least-privileged authenticated role.
//   - owner ("I own or manage a restaurant") — full access to their own
//     brands/locations once they exist.
//
// Deliberately NOT manager or admin: managers are provisioned only via the
// existing invite-by-email assignment flow (Location Managers sub-resource,
// backend/app/routers — it resolves an EXISTING Cognito user, never creates
// one), and admin accounts are provisioned manually by a human. Both stay
// exactly as they are today; this form only ever creates owner/
// registered_user accounts. Matches the existing codebase convention (see
// backend/app/dependencies/auth.py `_extract_role` — an authenticated user
// in no recognized pool group already falls back to "registered_user", the
// least-privileged role, by design).
//
// GROUP-ASSIGNMENT GAP (flagged in final report, not fixed here — outside
// /frontend per this agent's guardrails): infra/modules/cognito/main.tf's
// `role` custom attribute schema is commented "set by post-confirmation
// Lambda or admin", but no such Lambda trigger exists yet (no
// `lambda_config` block on the user pool) and the backend Lambda's IAM role
// explicitly excludes `cognito-idp:AdminAddUserToGroup` (see
// infra/CLAUDE.md "IAM Least-Privilege Rules" — ListUsers only). This form
// sets `custom:role` at sign-up (below) exactly as that schema comment
// anticipates, so a future post-confirmation Lambda can read it — but until
// that Lambda exists, a self-signed-up "owner" lands in NO Cognito group
// and is treated as registered_user by `_extract_role`'s fallback (i.e. no
// owner privileges) until an admin manually adds them to the "owner" group
// via the Cognito console/CLI. A self-signed-up diner needs nothing extra —
// the same fallback already IS registered_user, so that path works today
// with no infra change. See this PR's description for the exact Lambda
// spec being handed to Infra/Backend.
//
// Tokens never touch localStorage (frontend/CLAUDE.md) — this form never
// signs the user in itself; confirmSignUp() (app/signup/confirm) is the
// next step, and the existing LoginForm.tsx flow is what actually
// establishes a session afterward.
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signUp } from "@aws-amplify/auth";
import { ensureAmplifyConfigured } from "@/lib/auth/amplifyClient";
import { signUpSchema, type SignUpFormValues } from "@/lib/validation/auth";
import { messageForAuthError } from "@/lib/auth/errorMessages";
import { PasswordInput } from "@/components/ui/PasswordInput";

type Role = SignUpFormValues["role"];
type FieldErrors = Partial<Record<keyof SignUpFormValues, string>>;

const ROLE_OPTIONS: Array<{ value: Role; label: string; hint: string }> = [
  {
    value: "registered_user",
    label: "I'm a diner",
    hint: "Discover restaurants, follow favorites, and see deals.",
  },
  {
    value: "owner",
    label: "I own or manage a restaurant",
    hint: "List your restaurant, manage your menu, and run deals.",
  },
];

export default function SignUpForm({
  initialRole = "registered_user",
}: {
  /** Pre-selected account type (validated by the page; defaults to diner). */
  initialRole?: Role;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<Role>(initialRole);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const parsed = signUpSchema.safeParse({
      email,
      password,
      confirmPassword,
      role,
    });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof SignUpFormValues;
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    try {
      ensureAmplifyConfigured();
      const { isSignUpComplete, nextStep } = await signUp({
        username: parsed.data.email,
        password: parsed.data.password,
        options: {
          userAttributes: {
            email: parsed.data.email,
            // See the group-assignment-gap comment above — read by a future
            // post-confirmation Lambda trigger, not yet built.
            "custom:role": parsed.data.role,
          },
        },
      });

      if (!isSignUpComplete && nextStep.signUpStep === "CONFIRM_SIGN_UP") {
        router.push(`/signup/confirm?email=${encodeURIComponent(parsed.data.email)}`);
        return;
      }

      if (isSignUpComplete) {
        router.push("/login?confirmed=1");
        return;
      }

      // Any other next step (e.g. a hosted-UI-only path) isn't built —
      // Phase 1 scope is the code-confirmation flow above.
      setFormError(
        "Your account was created but needs an extra verification step we don't support yet. Please contact support."
      );
      setSubmitting(false);
    } catch (err) {
      setFormError(messageForAuthError(err, "sign-up"));
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

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-brand-ink-muted">
          Account type
        </legend>
        {ROLE_OPTIONS.map((option) => {
          const selected = role === option.value;
          return (
            <label
              key={option.value}
              className={
                selected
                  ? "flex cursor-pointer items-start gap-3 rounded-brand-control border-2 border-brand-accent bg-brand-bg p-3"
                  : "flex cursor-pointer items-start gap-3 rounded-brand-control border border-brand-border bg-white p-3 transition hover:border-brand-ink-subtle"
              }
            >
              <input
                type="radio"
                name="role"
                value={option.value}
                checked={selected}
                onChange={() => setRole(option.value)}
                className="mt-1 h-4 w-4 shrink-0 accent-brand-accent"
              />
              <span>
                <span className="block text-sm font-semibold text-brand-ink">
                  {option.label}
                </span>
                <span className="block text-sm text-brand-ink-muted">
                  {option.hint}
                </span>
              </span>
            </label>
          );
        })}
        {fieldErrors.role && (
          <p className="text-sm text-brand-closed">{fieldErrors.role}</p>
        )}
      </fieldset>

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
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby="password-hint"
          className="min-h-[44px] w-full rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink placeholder:text-brand-placeholder focus:outline-none focus:ring-2 focus:ring-brand-accent"
          placeholder="********"
        />
        <p id="password-hint" className="text-sm text-brand-ink-subtle">
          At least 8 characters, with an uppercase letter and a number.
        </p>
        {fieldErrors.password && (
          <p className="text-sm text-brand-closed">{fieldErrors.password}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="confirmPassword"
          className="text-sm font-medium text-brand-ink-muted"
        >
          Confirm password
        </label>
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          aria-invalid={Boolean(fieldErrors.confirmPassword)}
          className="min-h-[44px] w-full rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink placeholder:text-brand-placeholder focus:outline-none focus:ring-2 focus:ring-brand-accent"
          placeholder="********"
        />
        {fieldErrors.confirmPassword && (
          <p className="text-sm text-brand-closed">
            {fieldErrors.confirmPassword}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Creating account…" : "Create Account"}
      </button>

      <p className="text-center text-sm text-brand-ink-muted">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-brand-accent transition hover:text-brand-accent-hover"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
