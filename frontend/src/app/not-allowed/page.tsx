// Shown to a SIGNED-IN visitor who opens a page their role cannot use
// (lib/auth/guards.ts). Signed-out visitors go to /login instead.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import TopBar from "@/components/home/TopBar";
import { getServerSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Page not available",
  robots: { index: false, follow: false },
};

export default async function NotAllowedPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <div className="mx-auto flex max-w-6xl justify-center px-4 py-12 sm:px-6 sm:py-16">
        <div className="w-full max-w-md rounded-brand-card border border-brand-border bg-white p-6 text-center shadow-brand-card sm:p-8">
          <h1 className="font-display text-2xl font-bold text-brand-ink">
            This page isn&apos;t available to your account
          </h1>
          <p className="mt-2 text-sm text-brand-ink-muted">
            You&apos;re signed in
            {session.email ? (
              <>
                {" "}as <span className="break-all font-medium text-brand-ink">{session.email}</span>
              </>
            ) : null}
            . To use a different account, sign out from the account menu first.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Link
              href="/account"
              className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-4 text-sm font-semibold text-white transition hover:bg-brand-accent-hover"
            >
              Go to my account
            </Link>
            <Link
              href="/"
              className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border px-4 text-sm font-semibold text-brand-ink transition hover:bg-brand-bg"
            >
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
