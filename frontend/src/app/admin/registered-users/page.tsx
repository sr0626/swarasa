// Admin "Registered users" report -- diner (registered_user) directory:
// email, Cognito status, signup date, last visited. Linked from the
// Platform Overview page's "Registered users" tile
// (admin/overview/page.tsx) and its own console nav item
// (components/console/navItems.ts).
//
// Server-driven, no client state -- same shape as admin/overview/page.tsx
// (plain Server Component, page-number pagination via searchParams), not
// AdminListingsPanel.tsx's client-side interactive shape: this page has no
// filters or row actions, just a read-only paginated list.
//
// "Last visited" is a best-effort, throttled local timestamp
// (user_profile.last_seen_at) -- see docs/DECISIONS.md "Registered-user
// last-seen tracking" for the full design writeup. It can lag up to ~5
// minutes behind a diner's actual most recent request (the throttle
// window) and reads "Never" for anyone who signed up but has had no
// tracked activity yet -- not the same as "signed up a long time ago".
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import { ApiError } from "@/lib/api/client";
import { getRegisteredUsers } from "@/lib/api/adminRegisteredUsers";

export const metadata: Metadata = {
  title: "Registered Users",
};

const PAGE_SIZE = 20;

// Cognito UserStatus values this platform's pool can actually produce
// (root CLAUDE.md Cognito user pools; no custom lifecycle states) --
// rendered verbatim, this is just a display label lookup, not a remap.
const STATUS_LABELS: Record<string, string> = {
  CONFIRMED: "Confirmed",
  UNCONFIRMED: "Unconfirmed",
  ARCHIVED: "Archived",
  COMPROMISED: "Compromised",
  RESET_REQUIRED: "Reset required",
  FORCE_CHANGE_PASSWORD: "Force change password",
  UNKNOWN: "Unknown",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function formatDateTime(value: string | null): string {
  if (!value) return "Never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Never";
  return parsed.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

interface RegisteredUsersPageProps {
  searchParams: { page?: string };
}

export default async function RegisteredUsersPage({ searchParams }: RegisteredUsersPageProps) {
  const session = await requireSession(["admin"]);
  const page = parsePositiveInt(searchParams.page) ?? 1;

  let data: Awaited<ReturnType<typeof getRegisteredUsers>> | null = null;
  let loadError: string | null = null;
  try {
    data = await getRegisteredUsers({ page, page_size: PAGE_SIZE }, session.accessToken);
  } catch (error) {
    loadError =
      error instanceof ApiError
        ? error.message
        : "Something went wrong loading registered users. Please try again.";
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <section>
      <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
        Registered Users
      </h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        Every diner (&ldquo;registered_user&rdquo;) account: email and status from Cognito, plus
        signup date and last-visited timestamp. Owners, managers and admins are not diners and are
        not listed here -- see{" "}
        <Link
          href="/admin/overview"
          className="font-semibold text-brand-accent underline-offset-2 hover:underline"
        >
          Platform Overview
        </Link>{" "}
        for owner counts.
      </p>
      <p className="mt-1 text-xs text-brand-ink-subtle">
        &ldquo;Last visited&rdquo; can lag a signed-in diner&rsquo;s actual most recent activity by
        up to a few minutes (throttled to limit write volume), and reads &ldquo;Never&rdquo; for
        anyone who hasn&rsquo;t had a tracked authenticated request yet.
      </p>

      {loadError || !data ? (
        <p className="mt-6 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
          {loadError}
        </p>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded-brand-card border border-brand-border bg-white shadow-brand-card">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-brand-border text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
                  <th scope="col" className="px-4 py-3">
                    Email
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Signed up
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Last visited
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.results.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-brand-ink-subtle">
                      No registered users yet.
                    </td>
                  </tr>
                ) : (
                  data.results.map((user) => (
                    <tr key={user.cognito_sub} className="border-b border-brand-border last:border-0">
                      <td className="px-4 py-3 font-medium text-brand-ink">
                        {user.email ?? <span className="text-brand-ink-subtle">No email on file</span>}
                      </td>
                      <td className="px-4 py-3 text-brand-ink-muted">{statusLabel(user.status)}</td>
                      <td className="px-4 py-3 text-brand-ink-muted">
                        {formatDateTime(user.signup_at)}
                      </td>
                      <td className="px-4 py-3 text-brand-ink-muted">
                        {formatDateTime(user.last_seen_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <nav
              aria-label="Registered user pages"
              className="mt-6 flex items-center justify-center gap-3 text-sm"
            >
              <PageLink page={page - 1} disabled={page <= 1}>
                &larr; Previous
              </PageLink>
              <span className="text-brand-ink-subtle">
                Page {page} of {totalPages}
              </span>
              <PageLink page={page + 1} disabled={page >= totalPages}>
                Next &rarr;
              </PageLink>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

function PageLink({
  page,
  disabled,
  children,
}: {
  page: number;
  disabled: boolean;
  children: ReactNode;
}) {
  if (disabled) {
    return (
      <span className="rounded-brand-control border border-brand-border px-3 py-2 text-brand-ink-subtle/40">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={`/admin/registered-users?page=${page}`}
      className="rounded-brand-control border border-brand-border px-3 py-2 text-brand-ink-muted transition hover:bg-brand-chip"
    >
      {children}
    </Link>
  );
}
