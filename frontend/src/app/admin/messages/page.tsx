// Admin inbox for "Contact admin" messages from owners and managers — auth-
// gated (admin only). Backed by `GET /admin/messages` (docs/API_CONTRACTS.md
// "Contact admin"): status tab, free-text search and numbered pagination all
// live in the query string as plain links / a GET form, so each view is a
// real URL (same shape as /admin/reports).
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import InfoPanel from "@/components/ui/InfoPanel";
import AdminMessagesPanel from "@/components/admin/AdminMessagesPanel";
import { ApiError } from "@/lib/api/client";
import { listAdminMessages } from "@/lib/api/adminMessages";
import {
  MESSAGE_TABS,
  messagesHref,
  parseMessagePage,
  parseMessageQuery,
  parseMessageTab,
} from "@/lib/adminMessagesView";
import { MESSAGE_SEARCH_MAX_LENGTH, type AdminMessage } from "@/types/adminMessage";

export const metadata: Metadata = {
  title: "Messages",
};

const PAGE_SIZE = 20;

interface AdminMessagesPageProps {
  searchParams: { status?: string; q?: string; page?: string };
}

export default async function AdminMessagesPage({ searchParams }: AdminMessagesPageProps) {
  const session = await requireSession(["admin"]);

  const tab = parseMessageTab(searchParams.status);
  const page = parseMessagePage(searchParams.page);
  const q = parseMessageQuery(searchParams.q);

  let messages: AdminMessage[] = [];
  let total = 0;
  let openCount: number | null = null;
  let loadError: string | null = null;
  try {
    const result = await listAdminMessages(
      {
        status: tab === "all" ? undefined : tab,
        q: q || undefined,
        page,
        page_size: PAGE_SIZE,
      },
      session.accessToken
    );
    messages = result.results;
    total = result.total;
    openCount = result.open_count;
  } catch (error) {
    loadError =
      error instanceof ApiError
        ? error.message
        : "Something went wrong loading messages. Please try again.";
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section>
      <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">Messages</h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        Messages from owners and managers via &ldquo;Contact admin&rdquo;. Reply to the sender by
        email, then mark the message resolved.
        {openCount !== null && (
          <>
            {" "}
            <span className="font-semibold text-brand-ink">{openCount} open</span> in total.
          </>
        )}
      </p>

      <nav aria-label="Message status" className="mt-6 flex flex-wrap gap-2">
        {MESSAGE_TABS.map((t) => (
          <Link
            key={t.value}
            href={messagesHref(t.value, 1, q)}
            aria-current={t.value === tab ? "page" : undefined}
            className={
              t.value === tab
                ? "flex min-h-[44px] items-center rounded-brand-pill bg-brand-ink px-4 text-sm font-semibold text-brand-bg"
                : "flex min-h-[44px] items-center rounded-brand-pill border border-brand-border bg-white px-4 text-sm font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <form
        action="/admin/messages"
        method="get"
        role="search"
        className="mt-4 flex flex-col gap-2 sm:flex-row"
      >
        {tab !== "open" && <input type="hidden" name="status" value={tab} />}
        <label htmlFor="message-search" className="sr-only">
          Search messages
        </label>
        <input
          id="message-search"
          name="q"
          type="search"
          defaultValue={q}
          maxLength={MESSAGE_SEARCH_MAX_LENGTH}
          placeholder="Search subject, message, sender email or name"
          className="min-h-[44px] w-full rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none sm:max-w-md"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover"
          >
            Search
          </button>
          {q && (
            <Link
              href={messagesHref(tab, 1, "")}
              className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border px-5 text-sm font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
            >
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="mt-6">
        {loadError ? (
          <InfoPanel title="Couldn't load messages" body={loadError} />
        ) : (
          <>
            <p className="mb-3 text-sm text-brand-ink-subtle">
              {total} {total === 1 ? "message" : "messages"}
            </p>
            {/* Keyed so a filter/page/search change remounts with fresh data
                rather than reusing the previous view's local state. */}
            <AdminMessagesPanel
              key={`${tab}-${page}-${q}`}
              initialMessages={messages}
              statusFilter={tab === "all" ? null : tab}
            />
          </>
        )}
      </div>

      {!loadError && totalPages > 1 && (
        <nav
          aria-label="Message pages"
          className="mt-8 flex items-center justify-center gap-3 text-sm"
        >
          {page > 1 ? (
            <Link
              href={messagesHref(tab, page - 1, q)}
              className="flex min-h-[44px] items-center rounded-brand-control border border-brand-border px-4 font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
            >
              Previous
            </Link>
          ) : null}
          <span className="text-brand-ink-subtle">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={messagesHref(tab, page + 1, q)}
              className="flex min-h-[44px] items-center rounded-brand-control border border-brand-border px-4 font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
            >
              Next
            </Link>
          ) : null}
        </nav>
      )}
    </section>
  );
}
