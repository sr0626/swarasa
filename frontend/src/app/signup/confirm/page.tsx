// Account-activation code-entry page — reached from SignUpForm.tsx's
// redirect (`/signup/confirm?email=...`) after a successful signUp() call.
// `searchParams.email` is read server-side and handed to the client form as
// a prefill only (never trusted for anything else — confirmSignUp() itself
// still requires the matching code).
import type { Metadata } from "next";
import TopBar from "@/components/home/TopBar";
import ConfirmSignUpForm from "@/components/auth/ConfirmSignUpForm";

export const metadata: Metadata = {
  title: "Confirm Your Account",
};

export default function ConfirmSignUpPage({
  searchParams,
}: {
  searchParams: { email?: string };
}) {
  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />

      <div className="mx-auto flex max-w-6xl justify-center px-4 py-12 sm:px-6 sm:py-16">
        <div className="w-full max-w-md rounded-brand-card border border-brand-border bg-white p-6 shadow-brand-card sm:p-8">
          <h1 className="font-display text-2xl font-bold text-brand-ink">
            Confirm Your Account
          </h1>
          <p className="mt-1 text-sm text-brand-ink-muted">
            We sent a verification code to your email. Enter it below to
            activate your account.
          </p>

          <div className="mt-6">
            <ConfirmSignUpForm initialEmail={searchParams.email ?? ""} />
          </div>
        </div>
      </div>
    </main>
  );
}
