"use client";

// Admin Users directory list: one card per pool user with status chips and
// action buttons (Disable / Enable / Confirm sign-up / Reset password), each
// behind a confirm dialog. Search, filters and paging are server-rendered
// links/forms on the page; this component only owns per-row actions. The
// server re-validates every action (self / last-admin guards), so the buttons
// hidden here are a convenience, not the control.
//
// Mobile-first: cards stack at 375px, every control is >= 44px tall, and
// nothing forces horizontal scroll (emails break-all).
import { useEffect, useRef, useState } from "react";
import LocalDateTime from "@/components/ui/LocalDateTime";
import { adminUserAction } from "@/app/admin/users/actions";
import {
  ACTION_DONE,
  ACTION_LABELS,
  USER_ROLE_LABELS,
  actionConfirmText,
  availableActions,
  statusChips,
  type ChipTone,
} from "@/lib/adminUsersView";
import type { AdminUserAction, AdminUserRow } from "@/types/adminUsers";

const TONE_CLASS: Record<ChipTone, string> = {
  good: "bg-brand-success-bg text-brand-success",
  warn: "bg-brand-chip text-brand-chip-ink",
  bad: "bg-brand-closed-bg text-brand-closed",
  neutral: "bg-brand-chip text-brand-chip-ink",
};

interface PendingAction {
  user: AdminUserRow;
  action: AdminUserAction;
}

export default function AdminUsersPanel({ initialUsers }: { initialUsers: AdminUserRow[] }) {
  const [users, setUsers] = useState<AdminUserRow[]>(initialUsers);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (pending) cancelRef.current?.focus();
  }, [pending]);

  function openDialog(user: AdminUserRow, action: AdminUserAction, opener: HTMLElement) {
    openerRef.current = opener;
    setDialogError(null);
    setNotice(null);
    setPending({ user, action });
  }

  function closeDialog() {
    if (busy) return;
    setPending(null);
    openerRef.current?.focus();
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setDialogError(null);
    try {
      const outcome = await adminUserAction(pending.user.username, pending.action);
      if (!outcome.ok) {
        setDialogError(outcome.error);
        return;
      }
      const { result } = outcome;
      setUsers((prev) =>
        prev.map((u) => {
          if (u.username !== pending.user.username) return u;
          return {
            ...u,
            enabled: result.enabled ?? u.enabled,
            status: result.status ?? u.status,
            confirmed: result.action === "confirm" ? true : u.confirmed,
          };
        })
      );
      setNotice(`${pending.user.email ?? pending.user.username}: ${ACTION_DONE[pending.action]}`);
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const who = pending ? (pending.user.email ?? pending.user.username) : "";

  return (
    <>
      {notice && (
        <p
          role="status"
          className="mt-4 rounded-brand-control bg-brand-success-bg px-3 py-2.5 text-sm text-brand-success"
        >
          {notice}
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-4">
        {users.map((user) => (
          <li key={user.username}>
            <UserCard user={user} onAction={openDialog} />
          </li>
        ))}
      </ul>

      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-brand-ink/50 p-4 sm:items-center"
          onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}
          onKeyDown={(e) => e.key === "Escape" && closeDialog()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-user-dialog-title"
            className="w-full max-w-md rounded-brand-card bg-white p-5 shadow-brand-card-hover sm:p-6"
          >
            <h2
              id="admin-user-dialog-title"
              className="font-display text-lg font-bold text-brand-ink"
            >
              {ACTION_LABELS[pending.action]}?
            </h2>
            <p className="mt-2 break-words text-sm text-brand-ink-muted">
              {actionConfirmText(pending.action, who)}
            </p>
            {dialogError && (
              <p
                role="alert"
                className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
              >
                {dialogError}
              </p>
            )}
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                ref={cancelRef}
                type="button"
                onClick={closeDialog}
                disabled={busy}
                className="min-h-[44px] rounded-brand-control border border-brand-border px-5 text-sm font-semibold text-brand-ink transition hover:bg-brand-chip disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={busy}
                className={`min-h-[44px] rounded-brand-control px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50 ${
                  pending.action === "disable" || pending.action === "reset-password"
                    ? "bg-brand-closed"
                    : "bg-brand-accent"
                }`}
              >
                {busy ? "Working..." : `Yes, ${ACTION_LABELS[pending.action].toLowerCase()}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function UserCard({
  user,
  onAction,
}: {
  user: AdminUserRow;
  onAction: (user: AdminUserRow, action: AdminUserAction, opener: HTMLElement) => void;
}) {
  const actions = availableActions(user);
  return (
    <div className="rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="break-all font-display text-base font-bold text-brand-ink sm:text-lg">
            {user.email ?? (
              <span className="font-mono text-sm font-normal text-brand-ink-muted">
                {user.cognito_sub.slice(0, 8)}
              </span>
            )}
            {user.is_self && (
              <span className="ml-2 text-xs font-semibold text-brand-ink-subtle">(you)</span>
            )}
          </h2>
          {user.full_name && <p className="text-sm text-brand-ink-muted">{user.full_name}</p>}
        </div>
        <ul aria-label="Roles" className="flex flex-wrap gap-1.5">
          {user.roles.map((role) => (
            <li
              key={role}
              className="inline-flex items-center rounded-brand-pill border border-brand-border px-2.5 py-1 text-xs font-semibold text-brand-ink"
            >
              {USER_ROLE_LABELS[role]}
            </li>
          ))}
        </ul>
      </div>

      <ul aria-label="Account status" className="mt-3 flex flex-wrap gap-1.5">
        {statusChips(user).map((chip) => (
          <li
            key={chip.label}
            className={`inline-flex items-center rounded-brand-pill px-2.5 py-1 text-xs font-semibold ${TONE_CLASS[chip.tone]}`}
          >
            {chip.label}
          </li>
        ))}
      </ul>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
            Created
          </dt>
          <dd className="mt-0.5 text-brand-ink-muted">
            <LocalDateTime value={user.created_at} variant="date" fallback="Unknown" />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
            Last seen
          </dt>
          <dd className="mt-0.5 text-brand-ink-muted">
            <LocalDateTime value={user.last_seen_at} fallback="Never" />
          </dd>
        </div>
      </dl>

      {actions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              onClick={(e) => onAction(user, action, e.currentTarget)}
              className="min-h-[44px] min-w-[44px] rounded-brand-control border border-brand-border px-4 text-sm font-semibold text-brand-ink transition hover:bg-brand-chip"
            >
              {ACTION_LABELS[action]}
              <span className="sr-only"> {user.email ?? user.username}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
