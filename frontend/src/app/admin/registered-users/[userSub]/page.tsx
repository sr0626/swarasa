// Admin per-user activity view -- one diner's recorded searches and
// restaurant-tile clicks, newest first. Reached from the "Activity" link on
// each row of the Registered users report (../page.tsx).
//
// Server-driven like its parent page (page-number pagination + an optional
// event-type filter via searchParams, no client state). Only shows activity
// inside the retention window (12 months -- the API states the exact value in
// `retention_days`; see docs/DECISIONS.md "Registered-user activity tracking
// (searches + tile clicks)"). Only registered_user (diner) activity is ever
// recorded -- owners, managers, admins and anonymous visitors are not.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/guards";
import { ApiError } from "@/lib/api/client";
import { getRegisteredUserActivity } from "@/lib/api/adminRegisteredUsers";
import {
  describeResultCount,
  describeSearch,
  sourceLabel,
} from "@/lib/activity/describeEvent";
import type { ActivityEvent, ActivityEventType } from "@/types/userActivity";

export const metadata: Metadata = {
  title: "Registered User Activity",
};

const PAGE_SIZE = 25;

// Cognito `sub` shape (UUID). Anything else can't be a real diner id, so 404
// rather than issuing a pointless backend call.
const SUB_PATTERN = /^[0-9a-fA-F-]{8,36}$/;

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseEventType(value: string | undefined): ActivityEventType | undefined {
  return value === "search" || value === "tile_click" ? value : undefined;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

interface UserActivityPageProps {
  params: { userSub: string };
  searchParams: { page?: string; type?: string };
}

function hrefFor(userSub: string, page: number, type: ActivityEventType | undefined): string {
  const query = new URLSearchParams();
  if (type) query.set("type", type);
  if (page > 1) query.set("page", String(page));
  const qs = query.toString();
  return `/admin/registered-users/${encodeURIComponent(userSub)}${qs ? `?${qs}` : ""}`;
}

export default async function UserActivityPage({ params, searchParams }: UserActivityPageProps) {
  const session = await requireSession(["admin"]);
  const userSub = decodeURIComponent(params.userSub);
  if (!SUB_PATTERN.test(userSub)) notFound();

  const page = parsePositiveInt(searchParams.page) ?? 1;
  const type = parseEventType(searchParams.type);

  let data: Awaited<ReturnType<typeof getRegisteredUserActivity>> | null = null;
  let loadError: string | null = null;
  try {
    data = await getRegisteredUserActivity(
      userSub,
      { page, page_size: PAGE_SIZE, event_type: type },
      session.accessToken
    );
  } catch (error) {
    loadError =
      error instanceof ApiError
        ? error.message
        : "Something went wrong loading this user's activity. Please try again.";
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const retentionMonths = data ? Math.round(data.retention_days / 30) : 12;

  return (
    <section>
      <Link
        href="/admin/registered-users"
        className="text-sm font-semibold text-brand-accent underline-offset-2 hover:underline"
      >
        &larr; Registered users
      </Link>
      <h1 className="mt-3 font-display text-2xl font-bold text-brand-ink sm:text-3xl">
        User activity
      </h1>
      <p className="mt-2 break-all text-sm text-brand-ink-muted">
        Account ID: <span className="font-mono text-xs">{userSub}</span>
      </p>
      <p className="mt-1 text-xs text-brand-ink-subtle">
        Searches and restaurant clicks recorded while this person was signed in as a registered
        user, kept for {retentionMonths} months. Included in their data export and removed when a
        deletion request is approved.
      </p>

      <nav aria-label="Filter activity" className="mt-5 flex flex-wrap gap-2 text-sm">
        <FilterLink href={hrefFor(userSub, 1, undefined)} active={!type}>
          All
        </FilterLink>
        <FilterLink href={hrefFor(userSub, 1, "search")} active={type === "search"}>
          Searches
        </FilterLink>
        <FilterLink href={hrefFor(userSub, 1, "tile_click")} active={type === "tile_click"}>
          Restaurant clicks
        </FilterLink>
      </nav>

      {loadError || !data ? (
        <p className="mt-6 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
          {loadError}
        </p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto rounded-brand-card border border-brand-border bg-white shadow-brand-card">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-brand-border text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
                  <th scope="col" className="px-4 py-3">
                    When
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Type
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.results.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-brand-ink-subtle">
                      No activity recorded.
                    </td>
                  </tr>
                ) : (
                  data.results.map((event) => (
                    <tr key={event.id} className="border-b border-brand-border align-top last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 text-brand-ink-muted">
                        {formatDateTime(event.created_at)}
                      </td>
                      <td className="px-4 py-3 font-medium text-brand-ink">
                        {event.event_type === "search" ? "Search" : "Restaurant click"}
                      </td>
                      <td className="px-4 py-3 text-brand-ink-muted">
                        <EventDetails event={event} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <nav
              aria-label="Activity pages"
              className="mt-6 flex items-center justify-center gap-3 text-sm"
            >
              <PageLink href={hrefFor(userSub, page - 1, type)} disabled={page <= 1}>
                &larr; Previous
              </PageLink>
              <span className="text-brand-ink-subtle">
                Page {page} of {totalPages}
              </span>
              <PageLink href={hrefFor(userSub, page + 1, type)} disabled={page >= totalPages}>
                Next &rarr;
              </PageLink>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

function EventDetails({ event }: { event: ActivityEvent }) {
  if (event.event_type === "search") {
    const count = describeResultCount(event.payload.result_count);
    return (
      <div>
        <ul className="space-y-0.5">
          {describeSearch(event.payload).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {count && <p className="mt-1 text-xs text-brand-ink-subtle">{count}</p>}
      </div>
    );
  }
  return (
    <div>
      <p className="font-medium text-brand-ink">
        {event.brand_name ?? <span className="text-brand-ink-subtle">Removed restaurant</span>}
      </p>
      {event.location_label && <p className="text-xs">{event.location_label}</p>}
      <p className="mt-1 text-xs text-brand-ink-subtle">
        From {sourceLabel(event.payload.source)}
      </p>
    </div>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "rounded-brand-pill bg-brand-ink px-3.5 py-1.5 font-semibold text-brand-bg"
          : "rounded-brand-pill border border-brand-border px-3.5 py-1.5 text-brand-ink-muted transition hover:bg-brand-chip"
      }
    >
      {children}
    </Link>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
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
      href={href}
      className="rounded-brand-control border border-brand-border px-3 py-2 text-brand-ink-muted transition hover:bg-brand-chip"
    >
      {children}
    </Link>
  );
}
