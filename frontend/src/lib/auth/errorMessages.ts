// Shared Cognito error-message mapping for every auth form (sign-in,
// sign-up, confirm-sign-up, resend-code, forgot-password, reset-password).
//
// Pulled out of components/auth/LoginForm.tsx (which originally had its own
// private `messageForAuthError`/`messageForNextStep` pair) when sign-up and
// password-reset needed the exact same "never surface raw SDK error names"
// guarantee (root CLAUDE.md "NEVER expose internal stack details in API
// error responses") against a different, overlapping set of Cognito
// exception names. One mapping, one place to extend, instead of five forms
// each reinventing it slightly differently.
export type AuthErrorContext =
  | "sign-in"
  | "sign-up"
  | "confirm-sign-up"
  | "resend-code"
  | "forgot-password"
  | "reset-password";

const DEFAULT_MESSAGE: Record<AuthErrorContext, string> = {
  "sign-in": "Something went wrong signing in. Please try again.",
  "sign-up": "Something went wrong creating your account. Please try again.",
  "confirm-sign-up":
    "Something went wrong confirming your account. Please try again.",
  "resend-code": "Something went wrong sending a new code. Please try again.",
  "forgot-password":
    "Something went wrong requesting a reset code. Please try again.",
  "reset-password":
    "Something went wrong resetting your password. Please try again.",
};

/** Non-DONE sign-in steps we can explain without building a full challenge UI (out of Phase 1 scope). */
export function messageForNextStep(step: string): string {
  switch (step) {
    case "CONFIRM_SIGN_UP":
      return "Please confirm your email before signing in.";
    case "RESET_PASSWORD":
    case "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED":
      return "Your password needs to be reset before you can sign in. Contact support for help.";
    default:
      return "Additional verification is required to finish signing in.";
  }
}

/**
 * Maps known Cognito error names to friendly copy — never surface raw SDK
 * messages. `context` only changes copy where the right answer genuinely
 * differs (e.g. a not-found account during sign-in still says "incorrect
 * email or password" to avoid confirming the email isn't registered; the
 * same case during sign-up/reset flows has no such concern).
 */
export function messageForAuthError(
  err: unknown,
  context: AuthErrorContext = "sign-in"
): string {
  const name = err instanceof Error ? err.name : "";
  switch (name) {
    case "UserNotFoundException":
      // Never confirm/deny an email is registered outside sign-in, where
      // "incorrect email or password" already does that job safely.
      return context === "sign-in"
        ? "Incorrect email or password."
        : "We couldn't process that request. Please check the email address and try again.";
    case "NotAuthorizedException":
      return "Incorrect email or password.";
    case "UserNotConfirmedException":
      return "Please confirm your email before signing in.";
    case "UsernameExistsException":
    case "AliasExistsException":
      return "An account with that email already exists. Try signing in instead.";
    case "InvalidPasswordException":
      return "Password must be at least 8 characters and include an uppercase letter and a number.";
    case "CodeMismatchException":
      return "That code doesn't match. Please check it and try again.";
    case "ExpiredCodeException":
      return "That code has expired. Request a new one.";
    case "InvalidParameterException":
      return context === "reset-password" || context === "confirm-sign-up"
        ? "Please check the code and try again."
        : "Please check your details and try again.";
    case "LimitExceededException":
    case "TooManyRequestsException":
    case "TooManyFailedAttemptsException":
      return "Too many attempts. Please wait a moment and try again.";
    default:
      return DEFAULT_MESSAGE[context];
  }
}
