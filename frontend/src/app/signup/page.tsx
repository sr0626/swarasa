// Self-service sign-up page — mirrors app/login/page.tsx's shell exactly
// (same TopBar + centered rounded-brand-card layout) for visual consistency
// across the auth area. The form/Cognito wiring lives in
// components/auth/SignUpForm.tsx (a client component); this page stays a
// plain Server Component for the metadata/layout shell.
import type { Metadata } from "next";
import TopBar from "@/components/home/TopBar";
import SignUpForm from "@/components/auth/SignUpForm";
import { safeNextPath } from "@/lib/auth/safeNext";

export const metadata: Metadata = {
  title: "Create an Account",
};

// `?role=owner` (linked from the header's "Add Your Restaurant" CTA)
// pre-selects the Owner account type. Validated against the
// allowed value; anything else (missing, repeated, unknown) falls back to
// the default (diner).
export default function SignUpPage({
  searchParams,
}: {
  searchParams?: { role?: string | string[]; next?: string | string[] };
}) {
  const next = safeNextPath(searchParams?.next);
  // Owner when asked (?role=owner) OR when the visitor is being sent to an
  // owner area after sign-up (e.g. header "Add Your Restaurant" ->
  // /login?next=/portal/brands/new -> "Create an account").
  const initialRole =
    searchParams?.role === "owner" || next?.startsWith("/portal") ? "owner" : undefined;

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />

      <div className="mx-auto flex max-w-6xl justify-center px-4 py-12 sm:px-6 sm:py-16">
        <div className="w-full max-w-md rounded-brand-card border border-brand-border bg-white p-6 shadow-brand-card sm:p-8">
          <h1 className="font-display text-2xl font-bold text-brand-ink">
            Create an Account
          </h1>
          <p className="mt-1 text-sm text-brand-ink-muted">
            Sign up as a diner to follow restaurants and see deals, or as an
            owner to list and manage your restaurant.
          </p>

          <div className="mt-6">
            <SignUpForm initialRole={initialRole} nextPath={next} />
          </div>
        </div>
      </div>
    </main>
  );
}
