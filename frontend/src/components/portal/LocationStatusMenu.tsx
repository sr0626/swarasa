"use client";

// Listing-status label + action menu shown right next to the restaurant name
// in the location editor's heading. Replaces the old stand-alone "Listing
// status" panel (LocationStatusControl.tsx, removed) -- same server actions,
// same rules (see lib/portal/locationStatusActions.ts for the pure rule set),
// same wording (LocationStatusBadge), same confirmations.
//
//   - A manager (or anyone who can't change status) gets the plain,
//     non-interactive LocationStatusBadge.
//   - An owner/admin gets that same badge as the trigger of a small menu
//     (aria-haspopup="menu"): Escape closes and returns focus to the trigger,
//     Arrow/Home/End move between items, Tab closes.
//   - Switching between Active / Hidden / Coming soon applies immediately
//     (freely reversible, no confirmation -- as before).
//   - "Mark permanently closed", "Request to reopen" and "Remove this
//     location" open a modal dialog: close and remove keep an explicit
//     confirm button; reopen collects the optional notes. Remove is the last
//     item, visually separated and in the danger color.
//
// JUDGMENT CALL carried over from the panel: there is no GET for "the pending
// reopen request", so an existing pending request is only discovered from the
// submit call's 409 and remembered for this page view.
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  removeLocationAction,
  submitReopenRequestAction,
  updateLocationStatusAction,
} from "@/app/portal/locations/[id]/actions";
import LocationStatusBadge from "@/components/portal/LocationStatusBadge";
import { CheckIcon, ChevronDownIcon, ClockIcon, TrashIcon } from "@/components/ui/icons";
import { SELF_SERVICE_STATUSES, statusMenuActions } from "@/lib/portal/locationStatusActions";
import type { LocationStatus } from "@/types/location";

type DialogKind = "close" | "reopen" | "remove" | null;

const MENU_WIDTH = 288;
const VIEWPORT_GUTTER = 16;

const itemBase =
  "flex min-h-[44px] w-full items-center gap-2 rounded-brand-control px-3 text-left text-sm text-brand-ink focus:bg-brand-chip focus:outline-none disabled:cursor-not-allowed disabled:opacity-60";

export default function LocationStatusMenu({
  locationId,
  initialStatus,
  role,
  backHref,
}: {
  locationId: number;
  initialStatus: LocationStatus;
  role: string;
  /** Where to go after a successful permanent removal (page can't render
   * itself once the location is gone) -- same target as the page's back link. */
  backHref: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<LocationStatus>(initialStatus);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [reopenNotes, setReopenNotes] = useState("");
  const [reopenPending, setReopenPending] = useState(false);
  const [reopenJustSubmitted, setReopenJustSubmitted] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const focusItemOnOpen = useRef<"first" | "last" | null>(null);

  // The server value can move (router.refresh after another tab's change).
  useEffect(() => setStatus(initialStatus), [initialStatus]);

  const actions = statusMenuActions(status, role);

  // ---- menu positioning (fixed, clamped into the viewport) ----------------
  function place() {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const width = Math.min(MENU_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2);
    const left = Math.max(VIEWPORT_GUTTER, Math.min(rect.left, window.innerWidth - width - VIEWPORT_GUTTER));
    setPos({ left, top: rect.bottom + 4 });
  }

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  function menuItems(): HTMLElement[] {
    return Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? []);
  }

  // Move focus into the menu once it has rendered.
  useEffect(() => {
    if (!open) return;
    const items = menuItems();
    const which = focusItemOnOpen.current ?? "first";
    (which === "last" ? items[items.length - 1] : items[0])?.focus();
    focusItemOnOpen.current = null;
  }, [open]);

  // Click/touch outside closes.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent | TouchEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  function closeMenu(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function onButtonKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusItemOnOpen.current = e.key === "ArrowUp" ? "last" : "first";
      setOpen(true);
    }
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const items = menuItems();
    const idx = items.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        closeMenu(true);
        break;
      case "Tab":
        setOpen(false);
        break;
      case "ArrowDown":
        e.preventDefault();
        items[(idx + 1) % items.length]?.focus();
        break;
      case "ArrowUp":
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length]?.focus();
        break;
      case "Home":
        e.preventDefault();
        items[0]?.focus();
        break;
      case "End":
        e.preventDefault();
        items[items.length - 1]?.focus();
        break;
    }
  }

  // ---- actions --------------------------------------------------------------
  async function applyStatus(next: LocationStatus): Promise<string | null> {
    setError(null);
    setSaving(true);
    try {
      const result = await updateLocationStatusAction(locationId, next);
      if (result.ok) {
        setStatus(result.data.status);
        // The action already revalidates the path; refresh re-renders the
        // server-rendered page around this chip with the new status.
        router.refresh();
        return null;
      }
      setError(result.error);
      return result.error;
    } finally {
      setSaving(false);
    }
  }

  async function chooseStatus(next: LocationStatus) {
    closeMenu(true);
    if (next === status) return;
    await applyStatus(next);
  }

  function openDialog(kind: Exclude<DialogKind, null>) {
    setOpen(false);
    setError(null);
    setDialogError(null);
    setReopenJustSubmitted(false);
    setDialog(kind);
  }

  function closeDialog() {
    if (dialogBusy) return;
    setDialog(null);
    // Return focus to the trigger (the menu item that opened the dialog is gone).
    window.setTimeout(() => buttonRef.current?.focus(), 0);
  }

  async function confirmClose() {
    setDialogBusy(true);
    setDialogError(null);
    const failure = await applyStatus("closed_pending_reopen");
    setDialogBusy(false);
    if (failure === null) setDialog(null);
    else {
      // Show the reason inside the dialog, not also as a chip popover.
      setError(null);
      setDialogError(failure);
    }
  }

  async function submitReopen(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDialogBusy(true);
    setDialogError(null);
    try {
      const result = await submitReopenRequestAction(locationId, reopenNotes.trim());
      if (result.ok) {
        setReopenPending(true);
        setReopenJustSubmitted(true);
      } else if (result.error.toLowerCase().includes("already pending")) {
        setReopenPending(true);
        setReopenJustSubmitted(true);
      } else {
        setDialogError(result.error);
      }
    } finally {
      setDialogBusy(false);
    }
  }

  async function confirmRemove() {
    setDialogBusy(true);
    setDialogError(null);
    const result = await removeLocationAction(locationId);
    if (result.ok) {
      // The location no longer exists -- leave for wherever the caller came from.
      router.push(backHref);
      return;
    }
    setDialogBusy(false);
    setDialogError(result.error);
  }

  // ---- dialog focus handling (initial focus, trap, Escape) -------------------
  useEffect(() => {
    if (!dialog) return;
    const root = dialogRef.current;
    if (!root) return;
    const focusables = () =>
      Array.from(root.querySelectorAll<HTMLElement>("button, textarea, a[href]")).filter((el) => !el.hasAttribute("disabled"));
    // Start on the safe control (Cancel/textarea), never the destructive one.
    (root.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0])?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDialog();
      } else if (e.key === "Tab") {
        const els = focusables();
        if (els.length === 0) return;
        const first = els[0] as HTMLElement;
        const last = els[els.length - 1] as HTMLElement;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // closeDialog reads dialogBusy; re-bind when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog, dialogBusy, reopenJustSubmitted]);

  // ---- render ---------------------------------------------------------------
  if (!actions.interactive) {
    // Non-interactive label for a manager: exactly the old read-only badge.
    return (
      <span className="inline-flex items-center" data-testid="location-status-label">
        <span className="sr-only">Listing status: </span>
        <LocationStatusBadge status={status} />
      </span>
    );
  }

  const menuId = `location-status-menu-${locationId}`;

  return (
    <span className="relative inline-flex items-center" data-testid="location-status-menu">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Listing status: ${statusWord(status)}. Change status`}
        disabled={saving}
        onClick={() => {
          focusItemOnOpen.current = "first";
          setOpen((v) => !v);
        }}
        onKeyDown={onButtonKeyDown}
        className="inline-flex min-h-[44px] items-center gap-1 rounded-brand-pill px-1 transition hover:bg-brand-chip/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-wait disabled:opacity-70"
      >
        <LocationStatusBadge status={status} />
        <ChevronDownIcon className={`h-4 w-4 shrink-0 text-brand-ink-subtle transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {saving && <span className="sr-only" role="status">Saving status…</span>}

      {error && (
        <span
          role="alert"
          className="absolute left-0 top-full z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed shadow-brand-card"
        >
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 font-semibold underline">
            Dismiss
          </button>
        </span>
      )}

      {open && pos && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Listing status actions"
          onKeyDown={onMenuKeyDown}
          style={{ position: "fixed", left: pos.left, top: pos.top, width: Math.min(MENU_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2) }}
          className="z-50 rounded-brand-card border border-brand-border bg-white p-1.5 shadow-brand-card-hover"
        >
          {status === "closed_pending_reopen" && (
            <p role="presentation" className="px-3 py-2 text-xs text-brand-ink-muted">
              Closed and hidden from the public. Only an admin-approved reopen request can bring it back.
            </p>
          )}

          {actions.setStatus && (
            <>
              <p role="presentation" className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
                Visibility
              </p>
              {SELF_SERVICE_STATUSES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={status === option.value}
                  onClick={() => chooseStatus(option.value)}
                  className={itemBase}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {status === option.value && <CheckIcon className="h-4 w-4 text-brand-accent" />}
                  </span>
                  {option.label}
                </button>
              ))}
            </>
          )}

          {actions.markClosed && (
            <>
              <div role="separator" className="my-1.5 border-t border-brand-border" />
              <button type="button" role="menuitem" onClick={() => openDialog("close")} className={`${itemBase} text-brand-closed`}>
                <span className="h-4 w-4 shrink-0" />
                Mark permanently closed…
              </button>
            </>
          )}

          {actions.requestReopen && (
            <button
              type="button"
              role="menuitem"
              disabled={reopenPending}
              onClick={() => openDialog("reopen")}
              className={itemBase}
            >
              <ClockIcon className="h-4 w-4 shrink-0 text-brand-ink-subtle" />
              {reopenPending ? "Reopen request pending review" : "Request to reopen…"}
            </button>
          )}

          {actions.remove && (
            <>
              <div role="separator" className="my-1.5 border-t border-brand-border" />
              <button type="button" role="menuitem" onClick={() => openDialog("remove")} className={`${itemBase} font-semibold text-brand-closed`}>
                <TrashIcon className="h-4 w-4 shrink-0" />
                Remove this location…
              </button>
            </>
          )}
        </div>
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-brand-ink/50 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="location-status-dialog-title"
            className="w-full max-w-md rounded-brand-card bg-white p-5 shadow-brand-card-hover sm:p-6"
          >
            {dialog === "close" && (
              <>
                <h2 id="location-status-dialog-title" className="font-display text-lg font-bold text-brand-ink">
                  Permanently close this location?
                </h2>
                <p className="mt-2 text-sm text-brand-ink-muted">
                  Permanently closing this location is different from hiding it — once closed, you can&apos;t
                  reopen it yourself. You&apos;ll need to submit a reopen request for an admin to review.
                </p>
                <DialogButtons
                  busy={dialogBusy}
                  confirmLabel="Confirm — permanently close this location"
                  busyLabel="Closing..."
                  onConfirm={confirmClose}
                  onCancel={closeDialog}
                />
              </>
            )}

            {dialog === "remove" && (
              <>
                <h2 id="location-status-dialog-title" className="font-display text-lg font-bold text-brand-ink">
                  Remove this location permanently?
                </h2>
                <p className="mt-2 flex items-start gap-2 text-sm text-brand-ink-muted">
                  <TrashIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-closed" />
                  Removing this location permanently deletes it — unlike every other status change, this
                  can&apos;t be undone and the location can&apos;t be recovered. Any past manager assignments
                  for it are removed too.
                </p>
                <DialogButtons
                  busy={dialogBusy}
                  confirmLabel="Confirm — permanently remove this location"
                  busyLabel="Removing..."
                  onConfirm={confirmRemove}
                  onCancel={closeDialog}
                />
              </>
            )}

            {dialog === "reopen" && (
              <>
                <h2 id="location-status-dialog-title" className="font-display text-lg font-bold text-brand-ink">
                  Request to reopen
                </h2>
                {reopenJustSubmitted ? (
                  <>
                    <p className="mt-3 flex items-start gap-2 rounded-brand-control bg-brand-chip px-3 py-2.5 text-sm text-brand-chip-ink">
                      <ClockIcon className="mt-0.5 h-4 w-4 shrink-0" />
                      Reopen request submitted — pending admin review.
                    </p>
                    <button
                      type="button"
                      data-autofocus
                      onClick={closeDialog}
                      className="mt-4 flex min-h-[44px] w-full items-center justify-center rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover"
                    >
                      Done
                    </button>
                  </>
                ) : (
                  <form onSubmit={submitReopen} className="mt-3 flex flex-col gap-2">
                    <p className="text-sm text-brand-ink-muted">
                      This location is closed and hidden from the public. Only an admin-approved reopen request
                      can bring it back — you can&apos;t reopen it directly.
                    </p>
                    <label htmlFor="reopen-notes" className="text-sm font-semibold text-brand-ink">
                      Notes for the admin
                    </label>
                    <textarea
                      id="reopen-notes"
                      data-autofocus
                      value={reopenNotes}
                      onChange={(e) => setReopenNotes(e.target.value)}
                      placeholder="Optional: let the admin know why this should reopen (e.g. renovation finished)."
                      rows={3}
                      maxLength={2000}
                      className="w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={dialogBusy}
                      className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {dialogBusy ? "Submitting..." : "Submit reopen request"}
                    </button>
                    <button
                      type="button"
                      onClick={closeDialog}
                      className="flex min-h-[44px] items-center justify-center text-sm font-medium text-brand-ink-subtle underline"
                    >
                      Cancel
                    </button>
                  </form>
                )}
              </>
            )}

            {dialogError && (
              <p role="alert" className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
                {dialogError}
              </p>
            )}
          </div>
        </div>
      )}
    </span>
  );
}

function statusWord(status: LocationStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "owner_deactivated":
      return "Hidden";
    case "coming_soon":
      return "Coming soon";
    case "closed_pending_reopen":
      return "Closed, pending reopen";
  }
}

function DialogButtons({
  busy,
  confirmLabel,
  busyLabel,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  confirmLabel: string;
  busyLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-2">
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-closed px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? busyLabel : confirmLabel}
      </button>
      <button
        type="button"
        data-autofocus
        onClick={onCancel}
        disabled={busy}
        className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border text-sm font-semibold text-brand-ink transition hover:bg-brand-chip disabled:opacity-60"
      >
        Cancel
      </button>
    </div>
  );
}
