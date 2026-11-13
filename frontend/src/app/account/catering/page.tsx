// "My catering requests" — a registered user's own requests, each with its
// per-restaurant status and any quote (amount + note) as it arrives, plus a
// cancel action. First page is server-rendered; GET /catering/requests also
// lazily expires old open requests.
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import TopBar from "@/components/home/TopBar";
import InfoPanel from "@/components/ui/InfoPanel";
import MyCateringRequests from "@/components/catering/MyCateringRequests";
import { ApiError } from "@/lib/api/client";
import { listMyCateringRequests } from "@/lib/api/catering";
import type { CateringRequestList } from "@/types/catering";

export const metadata: Metadata = {
  title: "My catering requests",
};

const PAGE_SIZE = 20;

interface MyCateringPageProps {
  searchParams: { page?: string };
}

export default async function MyCateringRequestsPage({ searchParams }: MyCateringPageProps) {
  const session = await requireSession(["registered_user"], "/account/catering");
  const parsed = Number.parseInt(searchParams.page ?? "1", 10);
  const page = Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;

  let data: CateringRequestList | null = null;
  let loadError: string | null = null;
  try {
    data = await listMyCateringRequests({ page, page_size: PAGE_SIZE }, session.accessToken);
  } catch (error) {
    loadError =
      error instanceof ApiError
        ? error.message
        : "We couldn't load your catering requests. Please try again.";
  }
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
              My catering requests
            </h1>
            <p className="mt-2 text-sm text-brand-ink-muted">
              Quotes appear here as restaurants reply.
            </p>
          </div>
          <Link
            href="/account/catering/new"
            className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover"
          >
            Request catering quotes
          </Link>
        </div>

        <div className="mt-6">
          {loadError || !data ? (
            <InfoPanel title="Couldn't load your requests" body={loadError ?? "Please try again."} />
          ) : (
            <MyCateringRequests key={page} initialRequests={data.results} />
          )}
        </div>

        {data && totalPages > 1 && (
          <nav aria-label="Request pages" className="mt-8 flex items-center justify-center gap-3 text-sm">
            {page > 1 && (
              <Link
                href={`/account/catering?page=${page - 1}`}
                className="flex min-h-[44px] items-center rounded-brand-control border border-brand-border px-4 font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
              >
                Previous
              </Link>
            )}
            <span className="text-brand-ink-subtle">
              Page {page} of {totalPages}
            </span>
            {page < totalPages && (
              <Link
                href={`/account/catering?page=${page + 1}`}
                className="flex min-h-[44px] items-center rounded-brand-control border border-brand-border px-4 font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
              >
                Next
              </Link>
            )}
          </nav>
        )}
      </section>
    </main>
  );
}
