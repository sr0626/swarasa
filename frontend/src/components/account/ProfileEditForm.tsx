"use client";

// Owner-only profile edit form — PATCH /auth/me
// (docs/API_CONTRACTS.md "PATCH /auth/me").
//
// JUDGMENT CALL (flagged in this PR's description): the task brief for the
// account page assumed every role could edit their profile via
// `PATCH /auth/me`. Per the actual contract, that endpoint is
// "Auth: owner" only (backend/app/routers/auth.py's `update_me` uses
// `Depends(require_owner)`) — manager/admin/registered_user callers get a
// 403. So this form only renders for an owner session
// (see app/account/page.tsx); other roles get a read-only name/email
// display with a short note instead of a broken/silently-failing form.
import { useState } from "react";
import { updateProfileAction } from "@/app/account/actions";
import { PencilIcon } from "@/components/ui/icons";
import type { OwnerAccount } from "@/types/auth";

interface FormState {
  full_name: string;
  phone: string;
}

const inputClass =
  "mt-1.5 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none";
const labelClass = "text-sm font-semibold text-brand-ink";

export default function ProfileEditForm({ ownerAccount }: { ownerAccount: OwnerAccount }) {
  const [form, setForm] = useState<FormState>({
    full_name: ownerAccount.full_name ?? "",
    // Fixed 2026-09-17: GET /auth/me's OwnerAccountOut now returns phone
    // (it previously didn't, so this field always started blank even for
    // an owner who'd already set one — see docs/API_CONTRACTS.md).
    phone: ownerAccount.phone ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);

    try {
      const result = await updateProfileAction({
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
      });
      if (result.ok) {
        setSaved(true);
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
      <h2
        id="profile-edit-heading"
        className="flex items-center gap-2 font-display text-xl font-bold text-brand-ink"
      >
        <PencilIcon className="h-5 w-5 text-brand-ink-subtle" />
        Edit profile
      </h2>

      <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="full_name" className={labelClass}>
            Full name
          </label>
          <input
            id="full_name"
            type="text"
            required
            value={form.full_name}
            onChange={(e) => set("full_name", e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="phone" className={labelClass}>
            Phone
          </label>
          <input
            id="phone"
            type="tel"
            required
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="+14695551234"
            className={inputClass}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="sm:col-span-2 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
          >
            {error}
          </p>
        )}
        {saved && !error && (
          <p className="sm:col-span-2 rounded-brand-control bg-brand-success-bg px-3 py-2.5 text-sm text-brand-success">
            Saved.
          </p>
        )}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={saving}
            className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    </section>
  );
}
