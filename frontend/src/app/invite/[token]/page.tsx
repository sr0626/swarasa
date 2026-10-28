// Manager invitation landing page — /invite/<token>, the link an owner copies
// from the location editor's "Invite a manager" panel and sends themselves
// (no email is sent; SES is deferred).
//
// Server Component. The token is a bearer secret: this page is noindex /
// no-referrer, the preview call is a POST (token in the body, never a URL
// path the API logs), and every unusable token (unknown, expired, revoked,
// already used) gets the same generic "invalid" panel.
//
// Flow: signed out -> create an account / sign in (both carry `next` back
// here); signed in as a diner or manager account -> Accept; owner/admin
// accounts can't be managers -> explained.
import type { Metadata } from "next";
import Link from "next/link";
import TopBar from "@/components/home/TopBar";
import InviteAcceptance from "@/components/auth/InviteAcceptance";
import LocalDateTime from "@/components/ui/LocalDateTime";
import { previewManagerInvite } from "@/lib/api/managerInvites";
import { getServerSession } from "@/lib/auth/session";
import { withNext } from "@/lib/auth/safeNext";
import { inviteLandingFor, invitePath, isPlausibleInviteToken } from "@/lib/manager/invite";
import type { ManagerInvitePreview } from "@/types/managerInvite";

export const metadata: Metadata = {
  title: "Manager Invitation",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// Per-request: depends on the cookie session and a one-time token.
export const dynamic = "force-dynamic";

const linkButton =
  "flex min-h-[44px] w-full items-center justify-center rounded-brand-control px-5 text-sm font-semibold transition";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <div className="mx-auto flex max-w-6xl justify-center px-4 py-12 sm:px-6 sm:py-16">
        <div className="w-full max-w-md rounded-brand-card border border-brand-border bg-white p-6 shadow-brand-card sm:p-8">
          {children}
        </div>
      </div>
    </main>
  );
}

function InvalidInvite() {
  return (
    <Shell>
      <h1 className="font-display text-2xl font-bold text-brand-ink">Invitation not available</h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        This invitation is invalid or has expired. Ask the person who invited you to send a
        new link.
      </p>
      <Link
        href="/"
        className={`${linkButton} mt-6 border border-brand-border text-brand-ink hover:bg-brand-bg`}
      >
        Go to the homepage
      </Link>
    </Shell>
  );
}

export default async function InvitePage({ params }: { params: { token: string } }) {
  const token = params.token;
  if (!isPlausibleInviteToken(token)) return <InvalidInvite />;

  let preview: ManagerInvitePreview;
  try {
    preview = await previewManagerInvite(token);
  } catch {
    // Unknown / expired / revoked / used — indistinguishable by design.
    return <InvalidInvite />;
  }

  const session = await getServerSession();
  const landing = inviteLandingFor(session?.role ?? null);
  const name = preview.location_name
    ? `${preview.brand_name} — ${preview.location_name}`
    : preview.brand_name;
  const next = invitePath(token);

  return (
    <Shell>
      <h1 className="font-display text-2xl font-bold text-brand-ink">You&apos;re invited to manage a restaurant</h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        <strong className="text-brand-ink">{name}</strong> ({preview.city}) invited you to help manage
        its listing — edit details, hours, photos, menu and deals.
      </p>
      <p className="mt-2 text-xs text-brand-ink-subtle">
        This invitation expires <LocalDateTime value={preview.expires_at} variant="date" />. It is
        for the email address <span className="font-medium text-brand-ink-muted">{preview.email_hint}</span>.
      </p>

      <div className="mt-6">
        {landing === "signed_out" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-brand-ink-muted">
              Create an account (or sign in) using that email address, then you&apos;ll come back
              here to accept.
            </p>
            <Link
              href={withNext("/signup", next)}
              className={`${linkButton} bg-brand-accent text-white hover:bg-brand-accent-hover`}
            >
              Create an account
            </Link>
            <Link
              href={withNext("/login", next)}
              className={`${linkButton} border border-brand-border text-brand-ink hover:bg-brand-bg`}
            >
              I already have an account — sign in
            </Link>
          </div>
        )}

        {landing === "can_accept" && session && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-brand-ink-muted">
              Signed in as <span className="break-all font-medium text-brand-ink">{session.email}</span>. This must
              be the address the invitation was sent to.
            </p>
            <InviteAcceptance token={token} />
          </div>
        )}

        {landing === "wrong_account_type" && (
          <p role="alert" className="rounded-brand-control bg-brand-closed-bg px-3 py-2 text-sm text-brand-closed">
            Owner and admin accounts can&apos;t be used as a location manager. Sign out, then
            sign in with (or create) the account for the email address you were invited at.
          </p>
        )}
      </div>
    </Shell>
  );
}
