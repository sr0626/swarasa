"use client";

// "Invite a manager" panel — for someone who has NO account yet (the
// "Assign a manager by email" form above only works for existing accounts).
//
// SES is deferred, so NOTHING IS EMAILED. Creating an invite returns a
// single-use link once; the owner copies it and sends it to the person
// themselves (text, WhatsApp, email from their own inbox...). The invitee
// signs up / signs in with that email address and opens the link to accept.
//
// Only a hash of the link's token is stored server-side, so a link can't be
// shown again after creation. Links created in this browser session are kept
// in component state so "Copy link" keeps working; for any other pending
// invite the row offers "New link", which re-invites the same address (the
// server then revokes the older link).
//
// Owner, or admin acting for the owner (API: owner-or-admin). Pure rules live
// in lib/manager/invite.ts.
import { useRef, useState } from "react";
import {
  createManagerInviteAction,
  revokeManagerInviteAction,
} from "@/app/portal/locations/[id]/inviteActions";
import { inputClass } from "@/components/portal/formFields";
import LocalDateTime from "@/components/ui/LocalDateTime";
import { CheckIcon, MailIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import {
  INVITE_TTL_DAYS,
  buildInviteLink,
  inviteStatusLabel,
  normalizeInviteEmail,
  orderInvites,
  validateInviteEmail,
} from "@/lib/manager/invite";
import type { ManagerInvite } from "@/types/managerInvite";

export default function LocationManagerInvites({
  locationId,
  initialInvites,
}: {
  locationId: number;
  initialInvites: ManagerInvite[];
}) {
  const [invites, setInvites] = useState<ManagerInvite[]>(initialInvites);
  // invite id -> shareable link, only for invites created during this page view.
  const [links, setLinks] = useState<Record<number, string>>({});
  const [justCreatedId, setJustCreatedId] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [rowBusyId, setRowBusyId] = useState<number | null>(null);
  const [rowAction, setRowAction] = useState<"new" | "revoke" | null>(null);
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);

  const ordered = orderInvites(invites);
  const justCreated = invites.find((i) => i.id === justCreatedId) ?? null;
  const justCreatedLink = justCreated ? links[justCreated.id] : undefined;

  async function createFor(rawEmail: string): Promise<boolean> {
    const problem = validateInviteEmail(rawEmail);
    if (problem) {
      setCreateError(problem);
      return false;
    }
    const result = await createManagerInviteAction(locationId, normalizeInviteEmail(rawEmail));
    if (!result.ok) {
      setCreateError(result.error);
      return false;
    }
    const { token, ...invite } = result.data;
    const link = buildInviteLink(window.location.origin, token);
    setInvites((prev) => [
      invite,
      // A fresh link for the same address replaces the older pending row.
      ...prev.filter((i) => i.email !== invite.email),
    ]);
    setLinks((prev) => ({ ...prev, [invite.id]: link }));
    setJustCreatedId(invite.id);
    setCopiedId(null);
    return true;
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateError(null);
    setRowError(null);
    setCreating(true);
    try {
      if (await createFor(email)) setEmail("");
    } finally {
      setCreating(false);
    }
  }

  async function handleNewLink(invite: ManagerInvite) {
    setCreateError(null);
    setRowError(null);
    setRowBusyId(invite.id);
    setRowAction("new");
    try {
      await createFor(invite.email);
    } finally {
      setRowBusyId(null);
      setRowAction(null);
    }
  }

  async function handleRevoke(invite: ManagerInvite) {
    if (confirmingRevokeId !== invite.id) {
      setConfirmingRevokeId(invite.id);
      return;
    }
    setRowError(null);
    setRowBusyId(invite.id);
    setRowAction("revoke");
    try {
      const result = await revokeManagerInviteAction(locationId, invite.id);
      if (result.ok) {
        setInvites((prev) => prev.filter((i) => i.id !== invite.id));
        setLinks((prev) =>
          Object.fromEntries(Object.entries(prev).filter(([id]) => Number(id) !== invite.id))
        );
        if (justCreatedId === invite.id) setJustCreatedId(null);
      } else {
        setRowError(result.error);
      }
    } finally {
      setRowBusyId(null);
      setRowAction(null);
      setConfirmingRevokeId(null);
    }
  }

  async function copy(id: number) {
    const link = links[id];
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(id);
    } catch {
      // Clipboard API unavailable (insecure context / permissions): select
      // the visible link so Ctrl/Cmd+C works.
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
      setCopiedId(null);
    }
  }

  return (
    <section
      aria-labelledby="invite-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <h2
        id="invite-heading"
        className="flex items-center gap-2 font-display text-xl font-bold text-brand-ink"
      >
        <MailIcon className="h-5 w-5 text-brand-ink-subtle" />
        Invite a manager
      </h2>
      <p className="mt-1 text-sm text-brand-ink-muted">
        For someone who doesn&apos;t have an account yet. We don&apos;t send emails
        yet — you get a link to <strong>send to your manager yourself</strong>. They
        sign up (or sign in) with the email address you enter, then open the link.
        Each link works once and expires after {INVITE_TTL_DAYS} days.
      </p>

      {justCreated && justCreatedLink && (
        <div
          role="status"
          className="mt-4 rounded-brand-control border border-brand-accent bg-brand-bg p-3"
        >
          <p className="text-sm font-semibold text-brand-ink">
            Send this link to your manager
          </p>
          <p className="mt-0.5 text-xs text-brand-ink-muted">
            It&apos;s for <span className="break-all font-medium">{justCreated.email}</span> only,
            and it can&apos;t be shown again after you leave this page.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <label htmlFor="invite-link" className="sr-only">
              Invitation link
            </label>
            <input
              id="invite-link"
              ref={linkInputRef}
              readOnly
              value={justCreatedLink}
              onFocus={(e) => e.currentTarget.select()}
              className={`${inputClass(false)} !mt-0 flex-1`}
            />
            <button
              type="button"
              onClick={() => copy(justCreated.id)}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover"
            >
              {copiedId === justCreated.id ? (
                <>
                  <CheckIcon className="h-4 w-4" />
                  Copied
                </>
              ) : (
                "Copy link"
              )}
            </button>
          </div>
        </div>
      )}

      {ordered.length > 0 && (
        <ul className="mt-4 divide-y divide-brand-border rounded-brand-control border border-brand-border">
          {ordered.map((invite) => {
            const link = links[invite.id];
            const busy = rowBusyId === invite.id;
            return (
              <li key={invite.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-all text-sm font-medium text-brand-ink">{invite.email}</p>
                  <p className="text-xs text-brand-ink-subtle">
                    <span
                      className={
                        invite.status === "expired"
                          ? "font-semibold text-brand-closed"
                          : "font-semibold text-brand-ink-muted"
                      }
                    >
                      {inviteStatusLabel(invite.status)}
                    </span>
                    {" · "}
                    {invite.status === "expired" ? "expired " : "expires "}
                    <LocalDateTime value={invite.expires_at} variant="date" />
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {invite.status === "pending" && link && (
                    <button
                      type="button"
                      onClick={() => copy(invite.id)}
                      className="flex min-h-[44px] items-center gap-1.5 rounded-brand-control border border-brand-border px-3 text-xs font-semibold text-brand-ink transition hover:bg-brand-bg"
                    >
                      {copiedId === invite.id ? "Copied" : "Copy link"}
                    </button>
                  )}
                  {(invite.status === "expired" || !link) && (
                    <button
                      type="button"
                      onClick={() => handleNewLink(invite)}
                      disabled={busy}
                      className="flex min-h-[44px] items-center gap-1.5 rounded-brand-control border border-brand-border px-3 text-xs font-semibold text-brand-ink transition hover:bg-brand-bg disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy && rowAction === "new" ? "Creating..." : "New link"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRevoke(invite)}
                    disabled={busy}
                    className={
                      confirmingRevokeId === invite.id
                        ? "flex min-h-[44px] items-center gap-1.5 rounded-brand-control bg-brand-closed px-3 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        : "flex min-h-[44px] items-center gap-1.5 rounded-brand-control border border-brand-closed px-3 text-xs font-semibold text-brand-closed transition hover:bg-brand-closed-bg disabled:cursor-not-allowed disabled:opacity-60"
                    }
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                    {busy && rowAction === "revoke"
                      ? "Revoking..."
                      : confirmingRevokeId === invite.id
                      ? "Confirm revoke"
                      : "Revoke"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {ordered.length > 0 && !ordered.every((i) => links[i.id]) && (
        <p className="mt-2 text-xs text-brand-ink-subtle">
          A link can only be copied right after you create it. For an older invitation,
          choose &ldquo;New link&rdquo; — the previous link stops working.
        </p>
      )}

      {rowError && (
        <p role="alert" className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
          {rowError}
        </p>
      )}

      <form onSubmit={handleCreate} noValidate className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="invite_email" className="text-sm font-semibold text-brand-ink">
            Their email address
          </label>
          <input
            id="invite_email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="newmanager@example.com"
            aria-invalid={createError ? true : undefined}
            aria-describedby={createError ? "invite-error" : undefined}
            className={inputClass(Boolean(createError))}
          />
        </div>
        <button
          type="submit"
          disabled={creating}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          <PlusIcon className="h-4 w-4" />
          {creating ? "Creating..." : "Create invite link"}
        </button>
      </form>
      {createError && (
        <p
          id="invite-error"
          role="alert"
          className="mt-2 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {createError}
        </p>
      )}
    </section>
  );
}
