// Admin "Users" directory -- every account across all roles (owner, manager,
// admin, registered user) from Cognito, with search, role/status filters and
// admin actions (disable / enable / confirm sign-up / reset password), each
// behind a confirm dialog (AdminUsersPanel). Sibling of the Owners, Managers
// and Registered users reports; those remain the role-specific views.
//
// Server-driven: search + filters are a plain GET form, paging is link-based
// (AdminReportPager), so the list works without client state. The Cognito
// sweep is capped per group; when a cap is hit the API sets `truncated` and we
// say the list is incomplete instead of implying it is the whole pool. Times
// render via <LocalDateTime> in the viewer's timezone.
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import { ApiError } from "@/lib/api/client";
import { getAdminUsers } from "@/lib/api/adminUsers";
import { parsePage, parseSearch } from "@/lib/adminReportView";
import {
  USER_ROLES,
  USER_ROLE_LABELS,
  USER_SORTS,
  USER_SORT_LABELS,
  USER_STATUSES,
  USER_STATUS_LABELS,
  buildUsersHref,
  parseOption,
} from "@/lib/adminUsersView";
import { AdminReportPager } from "@/components/admin/AdminReportControls";
import AdminUsersPanel from "@/components/admin/AdminUsersPanel";
import AdminSummaryStrip from "@/components/admin/AdminSummaryStrip";
import { truncatedNote, usersSummaryChips } from "@/lib/adminSummary";

export const metadata: Metadata = {
  title: "Users",
};

const PAGE_SIZE = 20;

interface UsersPageProps {
  searchParams: { page?: string; q?: string; role?: string; status?: string; sort?: string };
}

const CONTROL =
  "mt-1 min-h-[44px] w-full rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink";
const LABEL = "block text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle";

export default async function AdminUsersPage({ searchParams }: UsersPageProps) {
  const session = await requireSession(["admin"]);
  const page = parsePage(searchParams.page);
  const q = parseSearch(searchParams.q);
  const role = parseOption(searchParams.role, USER_ROLES);
  const status = parseOption(searchParams.status, USER_STATUSES);
  const sort = parseOption(searchParams.sort, USER_SORTS) ?? "newest";

  let data: Awaited<ReturnType<typeof getAdminUsers>> | null = null;
  let loadError: string | null = null;
  try {
    data = await getAdminUsers(
      { page, page_size: PAGE_SIZE, q, role, status, sort },
      session.accessToken
    );
  } catch (error) {
    loadError =
      error instanceof ApiError
        ? error.message
        : "Something went wrong loading users. Please try again.";
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const filtered = Boolean(q || role || status || sort !== "newest");

  return (
    <section>
      <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">Users</h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        Every account across all roles. Disable a sign-in, confirm a stuck sign-up or trigger a
        password reset; every action is recorded in the{" "}
        <Link
          href="/admin/audit-log?entity=cognito_user"
          className="font-semibold text-brand-accent underline-offset-2 hover:underline"
        >
          audit log
        </Link>
        . You can&apos;t disable or reset your own account, or the last admin. Role-specific
        reports: {" "}
        <Link href="/admin/owners" className="font-semibold text-brand-accent underline-offset-2 hover:underline">
          Owners
        </Link>
        ,{" "}
        <Link href="/admin/managers" className="font-semibold text-brand-accent underline-offset-2 hover:underline">
          Managers
        </Link>
        ,{" "}
        <Link
          href="/admin/registered-users"
          className="font-semibold text-brand-accent underline-offset-2 hover:underline"
        >
          Registered users
        </Link>
        . Times are shown in your local timezone.
      </p>

      {data?.summary && (
        <AdminSummaryStrip
          chips={usersSummaryChips(data.summary)}
          note={truncatedNote(data.summary.truncated)}
        />
      )}

      <form
        method="get"
        action="/admin/users"
        role="search"
        className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="sm:col-span-2 lg:col-span-4">
          <label htmlFor="users-q" className={LABEL}>
            Search
          </label>
          <input
            id="users-q"
            name="q"
            type="search"
            defaultValue={q ?? ""}
            maxLength={100}
            placeholder="Email or name"
            className={CONTROL}
          />
        </div>
        <div>
          <label htmlFor="users-role" className={LABEL}>
            Role
          </label>
          <select id="users-role" name="role" defaultValue={role ?? ""} className={CONTROL}>
            <option value="">All roles</option>
            {USER_ROLES.map((value) => (
              <option key={value} value={value}>
                {USER_ROLE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="users-status" className={LABEL}>
            Status
          </label>
          <select id="users-status" name="status" defaultValue={status ?? ""} className={CONTROL}>
            <option value="">Any status</option>
            {USER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {USER_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="users-sort" className={LABEL}>
            Sort by
          </label>
          <select id="users-sort" name="sort" defaultValue={sort} className={CONTROL}>
            {USER_SORTS.map((value) => (
              <option key={value} value={value}>
                {USER_SORT_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-3">
          <button
            type="submit"
            className="min-h-[44px] flex-1 rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Apply
          </button>
          {filtered && (
            <Link
              href="/admin/users"
              className="flex min-h-[44px] items-center px-2 text-sm text-brand-ink-muted underline-offset-2 hover:underline"
            >
              Reset
            </Link>
          )}
        </div>
      </form>

      {loadError || !data ? (
        <p
          role="alert"
          className="mt-6 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {loadError}
        </p>
      ) : (
        <>
          {data.truncated && (
            <p
              role="status"
              className="mt-4 rounded-brand-control bg-brand-chip px-3 py-2.5 text-sm text-brand-ink"
            >
              This pool is larger than the directory limit, so the list below is incomplete. Use
              search to find a specific person.
            </p>
          )}
          <p className="mt-4 text-sm text-brand-ink-subtle">
            {data.total} {data.total === 1 ? "user" : "users"}
            {q ? ` matching “${q}”` : ""}
          </p>

          {data.results.length === 0 ? (
            <p className="mt-3 rounded-brand-card border border-dashed border-brand-border bg-white p-5 text-sm text-brand-ink-muted">
              {filtered ? "No users match these filters." : "No users yet."}
            </p>
          ) : (
            <AdminUsersPanel
              key={buildUsersHref({ page, q, role, status, sort })}
              initialUsers={data.results}
            />
          )}

          <AdminReportPager
            label="User pages"
            page={page}
            totalPages={totalPages}
            hrefFor={(target) => buildUsersHref({ page: target, q, role, status, sort })}
          />
        </>
      )}
    </section>
  );
}
