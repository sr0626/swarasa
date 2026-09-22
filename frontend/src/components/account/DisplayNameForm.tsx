"use client";

// Display-name-only edit form for registered_user/manager — PATCH /auth/me
// via the generalized `updateMyProfile` client (docs/PROJECT_PLAN.csv
// "Generic user display name for registered_user/manager"). Deliberately
// separate from components/account/ProfileEditForm.tsx (owner-only,
// full_name + phone against owner_account): this only ever writes
// `full_name` against the new `user_profile` table
// (backend/app/models/user_profile.py) — no phone field, since that table
// has none. Same visual shape/copy conventions as ProfileEditForm so the
// two forms read as one design language across roles.
import { useState } from "react";
import { updateDisplayNameAction } from "@/app/account/actions";
import { PencilIcon } from "@/components/ui/icons";

const inputClass =
  "mt-1.5 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none";
const labelClass = "text-sm font-semibold text-brand-ink";

export default function DisplayNameForm({
  initialFullName,
}: {
  /** Current saved name, or null if never set. */
  initialFullName: string | null;
}) {
  const [fullName, setFullName] = useState(initialFullName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);

    try {
      const result = await updateDisplayNameAction({ full_name: fullName.trim() });
      if (result.ok) {
        setFullName(result.data.full_name ?? "");
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
      aria-labelledby="display-name-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <h2
        id="display-name-heading"
        className="flex items-center gap-2 font-display text-xl font-bold text-brand-ink"
      >
        <PencilIcon className="h-5 w-5 text-brand-ink-subtle" />
        Your name
      </h2>
      <p className="mt-1 text-sm text-brand-ink-muted">
        Shown on your account and wherever we greet you by name.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="display_full_name" className={labelClass}>
            Full name
          </label>
          <input
            id="display_full_name"
            type="text"
            required
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              setSaved(false);
            }}
            className={inputClass}
          />
        </div>

        <button
          type="submit"
          disabled={saving || fullName.trim().length === 0}
          className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {saving ? "Saving..." : "Save name"}
        </button>
      </form>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="mt-3 rounded-brand-control bg-brand-success-bg px-3 py-2.5 text-sm text-brand-success">
          Saved.
        </p>
      )}
    </section>
  );
}
