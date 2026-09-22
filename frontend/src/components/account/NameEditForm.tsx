"use client";

// Generic, name-only profile edit form for the manager console — mirrors
// DinerAccountView's DisplayNameForm.tsx (same shared `updateDisplayNameAction`
// / `updateMyProfile` backend path, see lib/api/auth.ts's doc comment). Kept
// as its own small component rather than importing DisplayNameForm directly
// so the manager console isn't coupled to a diner-page component; a later
// pass could unify them if the duplication becomes a maintenance burden.
import { useState } from "react";
import { updateDisplayNameAction } from "@/app/account/actions";
import { PencilIcon } from "@/components/ui/icons";

export default function NameEditForm({
  currentName,
  email,
}: {
  currentName: string | null;
  email: string;
}) {
  const [fullName, setFullName] = useState(currentName ?? "");
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

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <div>
          <label htmlFor="full_name" className="text-sm font-semibold text-brand-ink">
            Full name
          </label>
          <input
            id="full_name"
            type="text"
            required
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              setSaved(false);
            }}
            className="mt-1.5 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none"
          />
        </div>

        <div>
          <span className="text-sm font-semibold text-brand-ink">Email</span>
          <p className="mt-1.5 break-all text-sm text-brand-ink-muted">{email}</p>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
          >
            {error}
          </p>
        )}
        {saved && !error && (
          <p className="rounded-brand-control bg-brand-success-bg px-3 py-2.5 text-sm text-brand-success">
            Saved.
          </p>
        )}

        <div>
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
