// Client-side validation mirroring PATCH /auth/me (docs/API_CONTRACTS.md "Auth").
import { z } from "zod";

export const updateAuthMeSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(200),
  phone: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/, "Enter a valid phone number"),
});

export type UpdateAuthMeFormValues = z.infer<typeof updateAuthMeSchema>;

/**
 * Display-name-only form (registered_user/manager, via
 * `updateMyProfile`/`DisplayNameForm.tsx`). Mirrors the backend's
 * `full_name` validation (`backend/app/schemas/auth.py`
 * `FULL_NAME_MAX_LENGTH = 255`) — max 255, not `updateAuthMeSchema`'s 200,
 * since that field's 200 was never a backend-enforced limit, just this
 * form's own choice; the new backend validator is the real source of
 * truth so this one matches it exactly.
 */
export const updateDisplayNameSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(255),
});

export type UpdateDisplayNameFormValues = z.infer<typeof updateDisplayNameSchema>;

const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Enter a valid email address");

/**
 * Mirrors the Cognito user pool's actual password policy
 * (infra/modules/cognito/main.tf `password_policy`: minimum_length = 8,
 * require_uppercase = true, require_numbers = true, require_symbols =
 * false) so an obviously-invalid attempt is caught before round-tripping to
 * Cognito. Cognito remains the source of truth for whether a password is
 * actually accepted — this is a client-side pre-check only. Shared by
 * sign-in, sign-up, and reset-password so the rule can't drift between them.
 */
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[0-9]/, "Password must include a number");

/** Sign-in form validation (frontend/src/components/auth/LoginForm.tsx). */
export const signInSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export type SignInFormValues = z.infer<typeof signInSchema>;

/**
 * Self-service sign-up (frontend/src/components/auth/SignUpForm.tsx).
 * `role` is restricted to the two self-service-eligible roles — manager and
 * admin are provisioned differently, never through this form (see
 * docs/PROJECT_PLAN.csv row 61 and SignUpForm.tsx's own header comment).
 */
export const signUpSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
    role: z.enum(["owner", "registered_user"], {
      errorMap: () => ({ message: "Choose an account type" }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SignUpFormValues = z.infer<typeof signUpSchema>;

/** Email-verification code entry after sign-up (app/signup/confirm). */
export const confirmSignUpSchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .min(1, "Enter the code from your email")
    .regex(/^\d+$/, "The code is numbers only"),
});

export type ConfirmSignUpFormValues = z.infer<typeof confirmSignUpSchema>;

/** Step 1 of forgot-password: request a reset code by email. */
export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
});

export type ForgotPasswordRequestValues = z.infer<
  typeof forgotPasswordRequestSchema
>;

/** Step 2 of forgot-password: code + new password (app/forgot-password/confirm). */
export const resetPasswordSchema = z
  .object({
    email: emailSchema,
    code: z
      .string()
      .trim()
      .min(1, "Enter the code from your email")
      .regex(/^\d+$/, "The code is numbers only"),
    newPassword: passwordSchema,
    confirmNewPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords do not match",
    path: ["confirmNewPassword"],
  });

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

/**
 * Change-password from a signed-in session (app/account/security,
 * components/account/ChangePasswordForm.tsx — docs/PROJECT_PLAN.csv
 * "Signed-in account dropdown in site header", the Security menu item).
 * Unlike `resetPasswordSchema` above (forgot-password flow, no current
 * password known), this is Cognito's `updatePassword({ oldPassword,
 * newPassword })` — it needs the current password to re-authenticate the
 * change, not a policy-shaped value, so it only requires non-empty rather
 * than reusing `passwordSchema`.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: passwordSchema,
    confirmNewPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords do not match",
    path: ["confirmNewPassword"],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from your current password",
    path: ["newPassword"],
  });

export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;
