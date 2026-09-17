// Forgot-password step 2 (code + new password) — reached from
// ForgotPasswordForm.tsx's redirect (`/forgot-password/confirm?email=...`).
// `searchParams.email` is a prefill only, same trust boundary as
// app/signup/confirm/page.tsx.
import type { Metadata } from "next";
import TopBar from "@/components/home/TopBar";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Reset Password",
};

export default function ResetPasswordPage({
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
            Reset Password
          </h1>
          <p className="mt-1 text-sm text-brand-ink-muted">
            Enter the code we sent to your email along with your new
            password.
          </p>

          <div className="mt-6">
            <ResetPasswordForm initialEmail={searchParams.email ?? ""} />
          </div>
        </div>
      </div>
    </main>
  );
}
