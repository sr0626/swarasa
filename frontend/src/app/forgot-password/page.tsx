// Forgot-password step 1 (request a reset code by email). Mirrors
// app/login/page.tsx's shell for visual consistency across the auth area.
import type { Metadata } from "next";
import TopBar from "@/components/home/TopBar";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Forgot Password",
};

export default function ForgotPasswordPage() {
  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />

      <div className="mx-auto flex max-w-6xl justify-center px-4 py-12 sm:px-6 sm:py-16">
        <div className="w-full max-w-md rounded-brand-card border border-brand-border bg-white p-6 shadow-brand-card sm:p-8">
          <h1 className="font-display text-2xl font-bold text-brand-ink">
            Forgot Password
          </h1>
          <p className="mt-1 text-sm text-brand-ink-muted">
            Enter your email and we&apos;ll send you a code to reset your
            password.
          </p>

          <div className="mt-6">
            <ForgotPasswordForm />
          </div>
        </div>
      </div>
    </main>
  );
}
