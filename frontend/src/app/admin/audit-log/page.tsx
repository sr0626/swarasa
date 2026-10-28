// Admin audit-log viewer -- read-only, newest first, over the whole audit_log
// table (GET /admin/audit-log). Filters: entity type, action, actor (email or
// sub) and a UTC date range, as a plain GET form; paging is link-based.
//
// Snapshots are untrusted data (they hold whatever users typed): they are
// only ever rendered as React text nodes inside <pre> -- never as HTML -- via
// snapshotText(). Times render via <LocalDateTime>; the date filter is in UTC
// (stated next to the inputs). Cards, not a wide table, so 375px never
// scrolls horizontally.
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import { ApiError } from "@/lib/api/client";
import { getAdminAuditLog } from "@/lib/api/adminAuditLog";
import { parsePage, parseSearch } from "@/lib/adminReportView";
import {
  ACTION_OPTIONS,
  ACTION_PATTERN,
  ENTITY_PATTERN,
  buildAuditHref,
  changedKeys,
  entityLabel,
  parseDateParam,
  parseToken,
  snapshotText,
} from "@/lib/adminAuditLogView";
import { AdminReportPager } from "@/components/admin/AdminReportControls";
import LocalDateTime from "@/components/ui/LocalDateTime";
import type { AuditLogEntry } from "@/types/adminAuditLog";

export const metadata: Metadata = {
  title: "Audit log",
};

const PAGE_SIZE = 25;

interface AuditLogPageProps {
  searchParams: {
    page?: string;
    entity?: string;
    action?: string;
    actor?: string;
    date_from?: string;
    date_to?: string;
  };
}

const CONTROL =
  "mt-1 min-h-[44px] w-full rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink";
const LABEL = "block text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle";

export default async function AdminAuditLogPage({ searchParams }: AuditLogPageProps) {
  const session = await requireSession(["admin"]);
  const page = parsePage(searchParams.page);
  const entity = parseToken(searchParams.entity, ENTITY_PATTERN);
  const action = parseToken(searchParams.action, ACTION_PATTERN);
  const actor = parseSearch(searchParams.actor);
  let dateFrom = parseDateParam(searchParams.date_from);
  let dateTo = parseDateParam(searchParams.date_to);
  // An inverted range would be a 422; swap it rather than show an error.
  if (dateFrom && dateTo && dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];

  let data: Awaited<ReturnType<typeof getAdminAuditLog>> | null = null;
  let loadError: string | null = null;
  try {
    data = await getAdminAuditLog(
      { page, page_size: PAGE_SIZE, entity, action, actor, date_from: dateFrom, date_to: dateTo },
      session.accessToken
    );
  } catch (error) {
    loadError =
      error instanceof ApiError
        ? error.message
        : "Something went wrong loading the audit log. Please try again.";
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const state = { entity, action, actor, date_from: dateFrom, date_to: dateTo };
  const filtered = Boolean(entity || action || actor || dateFrom || dateTo);
  const entityOptions = new Set(data?.entity_types ?? []);
  if (entity) entityOptions.add(entity);

  return (
    <section>
      <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">Audit log</h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        A read-only history of changes to restaurants, locations, managers, owner accounts and user
        accounts, newest first. Times are shown in your local timezone; the date filter uses UTC
        days.
      </p>

      <form
        method="get"
        action="/admin/audit-log"
        role="search"
        className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div>
          <label htmlFor="audit-entity" className={LABEL}>
            Entity type
          </label>
          <select id="audit-entity" name="entity" defaultValue={entity ?? ""} className={CONTROL}>
            <option value="">All entities</option>
            {[...entityOptions].sort().map((value) => (
              <option key={value} value={value}>
                {entityLabel(value)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="audit-action" className={LABEL}>
            Action
          </label>
          <select id="audit-action" name="action" defaultValue={action ?? ""} className={CONTROL}>
            <option value="">All actions</option>
            {ACTION_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-1">
          <label htmlFor="audit-actor" className={LABEL}>
            Actor (email or account ID)
          </label>
          <input
            id="audit-actor"
            name="actor"
            type="search"
            defaultValue={actor ?? ""}
            maxLength={100}
            placeholder="name@example.com"
            className={CONTROL}
          />
        </div>
        <div>
          <label htmlFor="audit-from" className={LABEL}>
            From (UTC date)
          </label>
          <input
            id="audit-from"
            name="date_from"
            type="date"
            defaultValue={dateFrom ?? ""}
            className={CONTROL}
          />
        </div>
        <div>
          <label htmlFor="audit-to" className={LABEL}>
            To (UTC date)
          </label>
          <input
            id="audit-to"
            name="date_to"
            type="date"
            defaultValue={dateTo ?? ""}
            className={CONTROL}
          />
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
              href="/admin/audit-log"
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
          {data.email_lookup_degraded && (
            <p
              role="status"
              className="mt-4 rounded-brand-control bg-brand-chip px-3 py-2.5 text-sm text-brand-ink"
            >
              Some actor emails are unavailable right now (the sign-in service did not respond), so
              those rows show a short account ID. Email search may miss them. Try again shortly.
            </p>
          )}
          <p className="mt-4 text-sm text-brand-ink-subtle">
            {data.total} {data.total === 1 ? "entry" : "entries"}
            {filtered ? " matching these filters" : ""}
          </p>

          {data.results.length === 0 ? (
            <p className="mt-3 rounded-brand-card border border-dashed border-brand-border bg-white p-5 text-sm text-brand-ink-muted">
              {filtered ? "No audit entries match these filters." : "No audit entries yet."}
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {data.results.map((entry) => (
                <li key={entry.id}>
                  <AuditEntryCard entry={entry} />
                </li>
              ))}
            </ul>
          )}

          <AdminReportPager
            label="Audit log pages"
            page={page}
            totalPages={totalPages}
            hrefFor={(target) => buildAuditHref({ ...state, page: target })}
          />
        </>
      )}
    </section>
  );
}

function AuditEntryCard({ entry }: { entry: AuditLogEntry }) {
  const keys = changedKeys(entry.old_val, entry.new_val);
  return (
    <article className="rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="min-w-0 break-words text-sm font-semibold text-brand-ink sm:text-base">
          {entry.summary}
        </h2>
        <span className="inline-flex items-center rounded-brand-pill bg-brand-chip px-2.5 py-1 text-xs font-semibold text-brand-chip-ink">
          {entry.action}
        </span>
      </div>

      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
            When
          </dt>
          <dd className="text-brand-ink-muted">
            <LocalDateTime value={entry.created_at} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
            Who
          </dt>
          <dd className="break-all text-brand-ink-muted">
            {entry.actor_label}{" "}
            <span className="text-brand-ink-subtle">({entry.actor_role})</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
            What
          </dt>
          <dd className="break-words text-brand-ink-muted">
            {entityLabel(entry.table_name)}
            {entry.table_name === "cognito_user" ? "" : ` #${entry.record_id}`}
          </dd>
        </div>
      </dl>

      {keys.length > 0 && (
        <p className="mt-2 break-words text-xs text-brand-ink-subtle">Changed: {keys.join(", ")}</p>
      )}

      {(entry.old_val || entry.new_val) && (
        <details className="mt-3">
          <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-semibold text-brand-accent">
            Before / after
          </summary>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Snapshot title="Before" value={snapshotText(entry.old_val)} />
            <Snapshot title="After" value={snapshotText(entry.new_val)} />
          </div>
        </details>
      )}
    </article>
  );
}

function Snapshot({ title, value }: { title: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">{title}</p>
      {/* Plain text node: React escapes it, so stored markup is shown, never run. */}
      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-brand-control bg-brand-bg p-2.5 text-xs text-brand-ink">
        {value}
      </pre>
    </div>
  );
}
