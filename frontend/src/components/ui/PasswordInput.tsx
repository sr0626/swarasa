"use client";

// Shared show/hide password reveal toggle (docs/PROJECT_PLAN.csv "Show/hide
// password toggle (eye icon) on all password fields") — wraps the existing
// password `<input>` markup pattern (LoginForm.tsx, SignUpForm.tsx,
// ResetPasswordForm.tsx all share it: `min-h-[44px] rounded-brand-control
// border border-brand-border ...`) with an icon button that toggles the
// field between `type="password"` and `type="text"`.
//
// Built as one reusable component rather than duplicating the toggle logic
// across 5 fields (login password; sign-up password + confirmPassword;
// reset newPassword + confirmNewPassword) — every call site already passes
// its own `id`/`name`/`value`/`onChange`/`aria-invalid`/`aria-describedby`/
// `className`/`placeholder` straight through via props, so this is purely
// additive and never touches existing validation/error wiring.
import { useId, useState, type InputHTMLAttributes } from "react";
import { EyeIcon, EyeOffIcon } from "./icons";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export function PasswordInput({
  className,
  id,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="relative">
      <input
        {...props}
        id={inputId}
        type={visible ? "text" : "password"}
        className={`${className ?? ""} pr-11`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-controls={inputId}
        className="absolute inset-y-0 right-0 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-brand-control text-brand-ink-subtle transition hover:text-brand-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-accent"
      >
        {visible ? (
          <EyeOffIcon className="h-5 w-5" />
        ) : (
          <EyeIcon className="h-5 w-5" />
        )}
      </button>
    </div>
  );
}
