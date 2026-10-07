// Admin "Registered users" report -- diner (registered_user) directory:
// email, Cognito status, signup date, last visited. Linked from the
// Platform Overview page's "Registered users" tile
// (admin/overview/page.tsx) and its own console nav item
// (components/console/navItems.ts).
//
// Server-driven, no client state: search (email or display name) + sort are
// a plain GET form (works without JS), pagination is link-based via
// searchParams -- the same shape as the Owners report (admin/owners/page.tsx).
//
// "Last visited" is a best-effort, throttled local timestamp
// (user_profile.last_seen_at) -- see docs/DECISIONS.md "Registered-user
// last-seen tracking" for the full design writeup. It can lag up to ~5
// minutes behind a diner's actual most recent request (the throttle
// window) and reads "Never" for anyone who signed up but has had no
// tracked activity yet -- not the same as "signed up a long time ago".
//
// All times render through <LocalDateTime> (the viewer's own timezone with
// an explicit zone label) -- this page is a Server Component, so formatting
// here would have used the SERVER's timezone (UTC).
//
// Each row links to the per-user activity view ([userSub]/page.tsx): that
// diner's recorded searches and restaurant-tile clicks (12-month retention,
// docs/DECISIONS.md "Registered-user activity tracking").
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import { ApiError } from "@/lib/api/client";
import { getRegisteredUsers } from "@/lib/api/adminRegisteredUsers";
import {
  REGISTERED_USER_SORTS,
  REGISTERED_USER_SORT_LABELS,
  buildReportHref,
  parsePage,
  parseSearch,
  parseSort,
} from "@/lib/adminReportView";
import { AdminReportPager, AdminReportSearchForm } from "@/components/admin/AdminReportControls";
import LocalDateTime from "@/components/ui/LocalDateTime";

export const metadata: Metadata = {
  title: "Registered Users",
};

const PAGE_SIZE = 20;
const BASE_PATH = "/admin/registered-users";

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

interface RegisteredUsersPageProps {
  searchParams: { page?: string; q?: string; sort?: string };
}

export default async function RegisteredUsersPage({ searchParams }: RegisteredUsersPageProps) {
  const session = await requireSession(["admin"]);
  const page = parsePage(searchParams.page);
  const q = parseSearch(searchParams.q);
  const sort = parseSort(searchParams.sort, REGISTERED_USER_SORTS, "newest");

  let data: Awaited<ReturnType<typeof getRegisteredUsers>> | null = null;
  let loadError: string | null = null;
  try {
    data = await getRegisteredUsers({ page, page_size: PAGE_SIZE, q, sort }, session.accessToken);
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
          href="/admin/owners"
          className="font-semibold text-brand-accent underline-offset-2 hover:underline"
        >
          Owners
        </Link>
        ,{" "}
        <Link
          href="/admin/managers"
          className="font-semibold text-brand-accent underline-offset-2 hover:underline"
        >
          Managers
        </Link>{" "}
        and{" "}
        <Link
          href="/admin/overview"
          className="font-semibold text-brand-accent underline-offset-2 hover:underline"
        >
          Platform Overview
        </Link>
        .
      </p>
      <p className="mt-1 text-xs text-brand-ink-subtle">
        &ldquo;Last visited&rdquo; can lag a signed-in diner&rsquo;s actual most recent activity by
        up to a few minutes (throttled to limit write volume), and reads &ldquo;Never&rdquo; for
        anyone who hasn&rsquo;t had a tracked authenticated request yet. Times are shown in your
        local timezone.
      </p>

      <AdminReportSearchForm
        action={BASE_PATH}
        idPrefix="users"
        q={q}
        sort={sort}
        defaultSort="newest"
        sortOptions={REGISTERED_USER_SORTS.map((value) => ({
          value,
          label: REGISTERED_USER_SORT_LABELS[value],
        }))}
        placeholder="Email or name"
      />

      {loadError || !data ? (
        <p
          role="alert"
          className="mt-6 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {loadError}
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm text-brand-ink-subtle">
            {data.total} {data.total === 1 ? "user" : "users"}
            {q ? ` matching “${q}”` : ""}
          </p>

          <div className="mt-3 overflow-x-auto rounded-brand-card border border-brand-border bg-white shadow-brand-card">
            <table className="w-full min-w-[760px] text-left text-sm">
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
                  <th scope="col" className="px-4 py-3">
                    Activity
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.results.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-brand-ink-subtle">
                      {q ? "No registered users match this search." : "No registered users yet."}
                    </td>
                  </tr>
                ) : (
                  data.results.map((user) => (
                    <tr key={user.cognito_sub} className="border-b border-brand-border last:border-0">
                      <td className="px-4 py-3 font-medium text-brand-ink">
                        {user.email ?? <span className="text-brand-ink-subtle">No email on file</span>}
                        {user.full_name && (
                          <span className="block text-xs font-normal text-brand-ink-muted">
                            {user.full_name}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-brand-ink-muted">{statusLabel(user.status)}</td>
                      <td className="px-4 py-3 text-brand-ink-muted">
                        <LocalDateTime value={user.signup_at} fallback="Unknown" />
                      </td>
                      <td className="px-4 py-3 text-brand-ink-muted">
                        <LocalDateTime value={user.last_seen_at} fallback="Never" />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/registered-users/${encodeURIComponent(user.cognito_sub)}`}
                          className="inline-flex min-h-[44px] items-center font-semibold text-brand-accent underline-offset-2 hover:underline"
                        >
                          Searches &amp; clicks
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <AdminReportPager
            label="Registered user pages"
            page={page}
            totalPages={totalPages}
            hrefFor={(target) => buildReportHref(BASE_PATH, { page: target, q, sort }, "newest")}
          />
        </>
      )}
    </section>
  );
}
