// Real Cognito sign-in page — replaces the bare placeholder Architect's
// review flagged. Reuses the shared TopBar (components/home/TopBar.tsx)
// for consistency with the rest of the "Spice Market" direction, and a
// centered card using the same rounded-brand-card/shadow-brand-card
// treatment as components/restaurant/ClaimCTA.tsx and the Hero search bar.
// The actual form/Cognito wiring lives in components/auth/LoginForm.tsx (a
// client component — @aws-amplify/auth only runs in the browser); this
// page itself needs no data fetching, so it stays a plain Server Component
// for the metadata/layout shell.
import type { Metadata } from "next";
import TopBar from "@/components/home/TopBar";
import LoginForm from "@/components/auth/LoginForm";
import { safeNextPath } from "@/lib/auth/safeNext";

export const metadata: Metadata = {
  title: "Sign In",
};

/**
 * `?confirmed=1` (from app/signup/confirm) and `?reset=1` (from
 * app/forgot-password/confirm) both land here after their respective flow
 * finishes — read server-side from `searchParams` (this page stays a plain
 * Server Component, same as before) so the confirmation banner survives a
 * full page load with no client-side state needed.
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams: { confirmed?: string; reset?: string; next?: string | string[] };
}) {
  const next = safeNextPath(searchParams.next);
  const banner = searchParams.confirmed
    ? "Your account is confirmed — sign in below."
    : searchParams.reset
      ? "Your password has been reset — sign in with your new password."
      : null;

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />

      <div className="mx-auto flex max-w-6xl justify-center px-4 py-12 sm:px-6 sm:py-16">
        <div className="w-full max-w-md rounded-brand-card border border-brand-border bg-white p-6 shadow-brand-card sm:p-8">
          <h1 className="font-display text-2xl font-bold text-brand-ink">
            Sign In
          </h1>
          <p className="mt-1 text-sm text-brand-ink-muted">
            Sign in to manage your restaurant listing or continue as a
            registered user.
          </p>

          {banner && (
            <p
              role="status"
              className="mt-4 rounded-brand-control bg-brand-success-bg px-3 py-2 text-sm text-brand-success"
            >
              {banner}
            </p>
          )}

          <div className="mt-6">
            <LoginForm nextPath={next} />
          </div>
        </div>
      </div>
    </main>
  );
}
