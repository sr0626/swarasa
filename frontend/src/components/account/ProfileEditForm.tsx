"use client";

// Owner-only profile section — PATCH /auth/me
// (docs/API_CONTRACTS.md "PATCH /auth/me").
//
// Compact by default (user feedback 2026-09-24: the always-open form read as
// clutter): a read-only summary of the name and phone with an "Edit phone"
// button that reveals the form. The name is set-once (PR #195): once it exists
// it stays read-only here with the "contact an admin" note, and only the phone
// is editable; an owner who has no name yet gets "Edit profile" and the name
// field too. A successful save collapses the form back to the summary and
// moves focus to the button. The phone follows the one shared US phone rule
// (lib/phone.ts) with an inline message; the server re-validates.
//
// JUDGMENT CALL (flagged in an earlier PR's description): `PATCH /auth/me` is
// "Auth: owner" only for the full owner_account edit
// (backend/app/routers/auth.py `update_me`), so this section only renders for
// an owner session (see components/account/OwnerAccountView.tsx); a manager
// has no phone at all (user_profile has no phone column) and already gets a
// read-only Account details card once their name is set.
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateProfileAction } from "@/app/account/actions";
import { NAME_LOCKED_NOTE, isNameLocked } from "@/components/account/accountShared";
import { PencilIcon } from "@/components/ui/icons";
import { formatPhone } from "@/lib/formatPhone";
import { phoneFieldError } from "@/lib/phone";
import type { OwnerAccount } from "@/types/auth";

const inputClass =
  "mt-1.5 min-h-[44px] w-full rounded-brand-control border bg-white px-3 py-2.5 text-base text-brand-ink placeholder:text-brand-placeholder focus:outline-none sm:text-sm";
const labelClass = "text-sm font-semibold text-brand-ink";
const primaryButton =
  "flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton =
  "flex min-h-[44px] items-center justify-center gap-2 rounded-brand-control border border-brand-border bg-white px-5 text-sm font-semibold text-brand-ink transition hover:border-brand-ink-subtle hover:bg-brand-chip focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-not-allowed disabled:opacity-60";

export default function ProfileEditForm({ ownerAccount }: { ownerAccount: OwnerAccount }) {
  const router = useRouter();
  const formId = useId();
  // Set-once name: when the owner already has one it renders read-only (the
  // backend rejects a change with 409 `name_locked`; an admin changes it on
  // request). Derived from the prop so a save that sets the first name locks
  // it after `router.refresh()` re-renders us.
  const nameLocked = isNameLocked(ownerAccount.full_name);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(ownerAccount.full_name ?? "");
  const [phone, setPhone] = useState(ownerAccount.phone ?? "");
  // What the summary shows; follows the server value and updates immediately
  // from a successful save (before the refresh lands).
  const [shownName, setShownName] = useState(ownerAccount.full_name);
  const [shownPhone, setShownPhone] = useState(ownerAccount.phone);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const editButtonRef = useRef<HTMLButtonElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    setShownName(ownerAccount.full_name);
    setShownPhone(ownerAccount.phone);
  }, [ownerAccount.full_name, ownerAccount.phone]);

  // Focus follows the open/close: into the first field when it opens, back to
  // the button when it closes after a save/cancel.
  useEffect(() => {
    if (editing) {
      firstFieldRef.current?.focus();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      editButtonRef.current?.focus();
    }
  }, [editing]);

  function openForm() {
    setName(shownName ?? "");
    setPhone(shownPhone ? formatPhone(shownPhone) : "");
    setPhoneError(null);
    setError(null);
    setSaved(false);
    setEditing(true);
  }

  function closeForm() {
    restoreFocus.current = true;
    setEditing(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const problem = phoneFieldError(phone);
    setPhoneError(problem);
    if (problem) {
      document.getElementById(`${formId}-phone`)?.focus();
      return;
    }

    setSaving(true);
    try {
      const result = await updateProfileAction({
        // When locked, re-send the stored name unchanged (backend treats an
        // identical name as a no-op) so this action's schema stays as is.
        full_name: nameLocked ? (ownerAccount.full_name ?? "").trim() : name.trim(),
        phone: phone.trim(),
      });
      if (result.ok) {
        if (result.data) {
          setShownName(result.data.full_name);
          setShownPhone(result.data.phone);
        }
        setSaved(true);
        closeForm();
        router.refresh();
      } else {
        setError(result.error);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="profile-edit-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="profile-edit-heading"
          className="flex items-center gap-2 font-display text-xl font-bold text-brand-ink"
        >
          <PencilIcon className="h-5 w-5 text-brand-ink-subtle" />
          Profile
        </h2>
        {!editing && (
          <button
            ref={editButtonRef}
            type="button"
            aria-expanded={false}
            onClick={openForm}
            className={secondaryButton}
          >
            <PencilIcon className="h-4 w-4" />
            {nameLocked ? "Edit phone" : "Edit profile"}
          </button>
        )}
      </div>

      {!editing && (
        <>
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className={labelClass}>Full name</dt>
              <dd className="mt-1 break-words text-sm text-brand-ink-muted">
                {shownName?.trim() ? shownName : "Not set"}
              </dd>
              {nameLocked && (
                <dd className="mt-1 text-xs text-brand-ink-subtle">{NAME_LOCKED_NOTE}</dd>
              )}
            </div>
            <div>
              <dt className={labelClass}>Phone</dt>
              <dd className="mt-1 break-words text-sm text-brand-ink-muted">
                {shownPhone ? formatPhone(shownPhone) : "Not set"}
              </dd>
            </div>
          </dl>
          {saved && !error && (
            <p
              role="status"
              className="mt-4 rounded-brand-control bg-brand-success-bg px-3 py-2.5 text-sm text-brand-success"
            >
              Saved.
            </p>
          )}
        </>
      )}

      {editing && (
        <form
          id={`${formId}-form`}
          onSubmit={handleSubmit}
          noValidate
          onKeyDown={(e) => {
            if (e.key === "Escape" && !saving) {
              e.stopPropagation();
              closeForm();
            }
          }}
          className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <div>
            {nameLocked ? (
              <>
                <span className={labelClass}>Full name</span>
                <p className="mt-1.5 break-words text-sm text-brand-ink-muted">
                  {ownerAccount.full_name}
                </p>
                <p className="mt-1 text-xs text-brand-ink-subtle">{NAME_LOCKED_NOTE}</p>
              </>
            ) : (
              <>
                <label htmlFor={`${formId}-name`} className={labelClass}>
                  Full name
                </label>
                <input
                  ref={firstFieldRef}
                  id={`${formId}-name`}
                  type="text"
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={`${inputClass} border-brand-border focus:border-brand-accent`}
                />
                <p className="mt-1 text-xs text-brand-ink-subtle">
                  You can set your name once — after that, only an admin can change it.
                </p>
              </>
            )}
          </div>

          <div>
            <label htmlFor={`${formId}-phone`} className={labelClass}>
              Phone
            </label>
            <input
              ref={nameLocked ? firstFieldRef : undefined}
              id={`${formId}-phone`}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={40}
              required
              aria-invalid={Boolean(phoneError)}
              aria-describedby={phoneError ? `${formId}-phone-error` : `${formId}-phone-hint`}
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (phoneError) setPhoneError(null);
              }}
              placeholder="(469) 555-1234"
              className={`${inputClass} ${
                phoneError
                  ? "border-brand-closed focus:border-brand-closed"
                  : "border-brand-border focus:border-brand-accent"
              }`}
            />
            {phoneError ? (
              <p
                id={`${formId}-phone-error`}
                role="alert"
                className="mt-1 text-xs font-medium text-brand-closed"
              >
                {phoneError}
              </p>
            ) : (
              <p id={`${formId}-phone-hint`} className="mt-1 text-xs text-brand-ink-subtle">
                A 10-digit US number, e.g. (469) 555-1234.
              </p>
            )}
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed sm:col-span-2"
            >
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3 sm:col-span-2">
            <button type="submit" disabled={saving} className={primaryButton}>
              {saving ? "Saving..." : "Save changes"}
            </button>
            <button type="button" disabled={saving} onClick={closeForm} className={secondaryButton}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
