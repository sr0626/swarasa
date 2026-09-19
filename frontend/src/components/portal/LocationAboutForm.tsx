"use client";

// "About & specialties" editor — PATCH /locations/{id} with `about` and
// `specialties` (docs/API_CONTRACTS.md "PATCH /locations/{id}"). Both are
// location-level (not brand-level) so an assigned manager can edit them,
// same as every other field on this page. Clearing a field (empty
// textarea / no chips) sends null, which the backend treats as "clear".
import { useState } from "react";
import { updateLocationAboutAction } from "@/app/portal/locations/[id]/actions";
import { PencilIcon } from "@/components/ui/icons";
import {
  ABOUT_MAX_LENGTH,
  SPECIALTIES_MAX_ITEMS,
  SPECIALTY_MAX_LENGTH,
} from "@/lib/validation/location";

interface LocationAboutFormProps {
  locationId: number;
  about: string | null;
  specialties: string[] | null;
}

const inputClass =
  "mt-1.5 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none";
const labelClass = "text-sm font-semibold text-brand-ink";

export default function LocationAboutForm({
  locationId,
  about,
  specialties,
}: LocationAboutFormProps) {
  const [aboutText, setAboutText] = useState(about ?? "");
  const [chips, setChips] = useState<string[]>(specialties ?? []);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /** Adds several chips at once (paste of "a, b, c") with one state update. */
  function addChips(raws: string[]) {
    let next = chips;
    for (const raw of raws) {
      const value = raw.trim();
      if (!value) continue;
      if (value.length > SPECIALTY_MAX_LENGTH) {
        setError(`Each specialty must be at most ${SPECIALTY_MAX_LENGTH} characters.`);
        return false;
      }
      if (next.some((chip) => chip.toLowerCase() === value.toLowerCase())) continue;
      if (next.length >= SPECIALTIES_MAX_ITEMS) {
        setError(`You can add at most ${SPECIALTIES_MAX_ITEMS} specialties.`);
        return false;
      }
      next = [...next, value];
    }
    setChips(next);
    setError(null);
    setSaved(false);
    return true;
  }

  function removeChip(index: number) {
    setChips((prev) => prev.filter((_, i) => i !== index));
    setError(null);
    setSaved(false);
  }

  function handleDraftKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      // Enter must not submit the surrounding form; comma is the separator.
      e.preventDefault();
      if (addChips([draft])) setDraft("");
    } else if (e.key === "Backspace" && draft === "" && chips.length > 0) {
      removeChip(chips.length - 1);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    // A half-typed chip still in the input counts as intended.
    const pending = draft.trim();
    let nextChips = chips;
    if (pending && !chips.some((chip) => chip.toLowerCase() === pending.toLowerCase())) {
      if (chips.length >= SPECIALTIES_MAX_ITEMS) {
        setError(`You can add at most ${SPECIALTIES_MAX_ITEMS} specialties.`);
        return;
      }
      nextChips = [...chips, pending];
    }

    setSaving(true);
    try {
      const result = await updateLocationAboutAction(locationId, {
        about: aboutText.trim() || null,
        specialties: nextChips.length > 0 ? nextChips : null,
      });
      if (result.ok) {
        setAboutText(result.data.about ?? "");
        setChips(result.data.specialties ?? []);
        setDraft("");
        setSaved(true);
      } else {
        setError(result.error);
      }
    } finally {
      setSaving(false);
    }
  }

  const remaining = ABOUT_MAX_LENGTH - aboutText.length;

  return (
    <section
      aria-labelledby="about-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <h2 id="about-heading" className="flex items-center gap-2 font-display text-xl font-bold text-brand-ink">
        <PencilIcon className="h-5 w-5 text-brand-ink-subtle" />
        About &amp; specialties
      </h2>
      <p className="mt-1 text-sm text-brand-ink-muted">
        Shown on your public page. Tell diners what makes this restaurant special.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <div>
          <label htmlFor="about" className={labelClass}>About this restaurant</label>
          <textarea
            id="about"
            rows={5}
            maxLength={ABOUT_MAX_LENGTH}
            value={aboutText}
            onChange={(e) => {
              setAboutText(e.target.value);
              setSaved(false);
            }}
            placeholder="We specialize in ..."
            className={inputClass}
          />
          <p
            className={`mt-1 text-right text-xs ${remaining < 50 ? "text-brand-closed" : "text-brand-ink-subtle"}`}
            aria-live="polite"
          >
            {aboutText.length} / {ABOUT_MAX_LENGTH}
          </p>
        </div>

        <div>
          <label htmlFor="specialty-input" className={labelClass}>Specialties</label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-brand-control border border-brand-border bg-white px-3 py-2 focus-within:border-brand-accent">
            {chips.map((chip, index) => (
              <span
                key={chip}
                className="inline-flex items-center gap-1 rounded-brand-pill bg-brand-bg px-3 py-1 text-sm text-brand-ink"
              >
                {chip}
                <button
                  type="button"
                  onClick={() => removeChip(index)}
                  aria-label={`Remove ${chip}`}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-brand-ink-subtle hover:text-brand-ink"
                >
                  &times;
                </button>
              </span>
            ))}
            <input
              id="specialty-input"
              type="text"
              value={draft}
              maxLength={SPECIALTY_MAX_LENGTH}
              disabled={chips.length >= SPECIALTIES_MAX_ITEMS}
              onChange={(e) => {
                // Pasting/typing "a, b" adds the completed parts as chips.
                if (e.target.value.includes(",")) {
                  const parts = e.target.value.split(",");
                  const last = parts.pop() ?? "";
                  setDraft(addChips(parts) ? last : e.target.value);
                } else {
                  setDraft(e.target.value);
                }
              }}
              onKeyDown={handleDraftKeyDown}
              placeholder={chips.length === 0 ? "e.g. Hyderabadi biryani" : ""}
              className="min-w-[10rem] flex-1 border-0 bg-transparent p-1 text-sm text-brand-ink placeholder:text-brand-placeholder focus:outline-none"
            />
          </div>
          <p className="mt-1 text-xs text-brand-ink-subtle">
            Type and press Enter or comma to add. {chips.length} / {SPECIALTIES_MAX_ITEMS}
          </p>
        </div>

        {error && (
          <p className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
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
            {saving ? "Saving..." : "Save about & specialties"}
          </button>
        </div>
      </form>
    </section>
  );
}
