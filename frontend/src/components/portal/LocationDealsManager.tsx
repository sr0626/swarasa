"use client";

// Owner/manager/admin deals editor for the location editor page —
// docs/API_CONTRACTS.md "Deals (`deal`)". Lists EVERY deal for the location
// (active or not — the management endpoint returns all of them), with
// create, edit, activate/deactivate and delete.
//
// Free-tier feature: deliberately no `is_paid` prop, check, upsell or copy
// anywhere in this file (product decision, 2026-09-23 — any owner/manager
// can add deals regardless of tier).
//
// Day picker follows LocationHoursEditor's convention (0=Monday..6=Sunday,
// same DAY_NAMES order) but as toggle chips rather than a row per day: no
// day selected means "every day" (sent as null — the backend rejects an
// explicit empty list).
//
// Delete is a real, irreversible hard delete on the backend, so it uses the
// same two-step "click, then Confirm" pattern as LocationManagerAssignment /
// LocationStatusMenu. Deactivate is the reversible alternative and is
// offered right next to it.
import { useState } from "react";
import {
  createLocationDealAction,
  deleteLocationDealAction,
  updateLocationDealAction,
} from "@/app/portal/locations/[id]/actions";
import { PencilIcon, PlusIcon, TagIcon, TrashIcon } from "@/components/ui/icons";
import { formatDealDateRange, formatDealDays } from "@/lib/deals/format";
import {
  DEAL_DESCRIPTION_MAX_LENGTH,
  DEAL_TITLE_MAX_LENGTH,
  dealFormSchema,
} from "@/lib/validation/deal";
import { fieldErrorsFromZod, type FieldErrors } from "@/lib/validation/fieldErrors";
import type { Deal, DealType } from "@/types/deal";
import { SECTION_ANCHOR_CLASS } from "@/components/portal/editorSectionAnchor";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_ABBREVIATIONS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const errorTextClass = "mt-1 text-xs font-medium text-brand-closed";

const inputClass =
  "mt-1.5 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none";
const labelClass = "text-sm font-semibold text-brand-ink";

interface DealFormState {
  deal_type: DealType;
  title: string;
  description: string;
  applicable_days: number[];
  /** `<input type="datetime-local">` value ("YYYY-MM-DDTHH:MM") or "". */
  start_at: string;
  end_at: string;
  /** Explicit "no end date" — required to leave `end_at` empty. */
  ongoing: boolean;
  is_active: boolean;
}

const EMPTY_FORM: DealFormState = {
  deal_type: "deal",
  title: "",
  description: "",
  applicable_days: [],
  start_at: "",
  end_at: "",
  ongoing: false,
  is_active: true,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO instant -> "YYYY-MM-DDTHH:MM" in the browser's local timezone, the
 * inverse of the `new Date(value).toISOString()` in lib/validation/deal.ts. */
function toDateTimeInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** True for a deal created before start dates were required (start_at NULL). */
function isLegacyUndated(deal: Deal): boolean {
  return deal.start_at === null;
}

function formFromDeal(deal: Deal): DealFormState {
  // Legacy handling (no migration/backfill): a deal created before start
  // dates were required has start_at NULL. Editing it must not dead-end on
  // a blank required field, so the start box is pre-filled with the date the
  // deal was created (it has effectively been running since then) and the
  // form shows a short note. A NULL end_at is shown as "Ongoing" ticked,
  // which is exactly what it already meant.
  const startIso = deal.start_at ?? deal.created_at;
  return {
    deal_type: deal.deal_type,
    title: deal.title,
    description: deal.description ?? "",
    applicable_days: deal.applicable_days ? [...deal.applicable_days] : [],
    start_at: toDateTimeInputValue(startIso),
    end_at: toDateTimeInputValue(deal.end_at),
    ongoing: deal.end_at === null,
    is_active: deal.is_active,
  };
}

export default function LocationDealsManager({
  locationId,
  initialDeals,
}: {
  locationId: number;
  initialDeals: Deal[];
}) {
  const [deals, setDeals] = useState<Deal[]>(initialDeals);
  // null = form closed, "new" = creating, number = editing that deal id.
  const [editing, setEditing] = useState<"new" | number | null>(null);
  const [form, setForm] = useState<DealFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Inline per-field messages from the client-side check (start/end dates,
  // title). The server re-validates everything regardless.
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // Shown when editing a legacy deal whose start date was pre-filled.
  const [legacyStartNote, setLegacyStartNote] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setFieldErrors({});
    setLegacyStartNote(false);
    setEditing("new");
  }

  function openEdit(deal: Deal) {
    setForm(formFromDeal(deal));
    setFormError(null);
    setFieldErrors({});
    setLegacyStartNote(isLegacyUndated(deal));
    setListError(null);
    setConfirmingDeleteId(null);
    setEditing(deal.id);
  }

  function closeForm() {
    setEditing(null);
    setFormError(null);
    setFieldErrors({});
    setLegacyStartNote(false);
  }

  function patchForm(patch: Partial<DealFormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
    // Editing a field clears its own stale inline error.
    setFieldErrors((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(patch)) delete next[key];
      // The two date boxes validate together (end vs start, Ongoing vs end).
      if ("start_at" in patch || "end_at" in patch || "ongoing" in patch) {
        delete next.start_at;
        delete next.end_at;
      }
      return next;
    });
  }

  function toggleDay(day: number) {
    setForm((prev) => ({
      ...prev,
      applicable_days: prev.applicable_days.includes(day)
        ? prev.applicable_days.filter((d) => d !== day)
        : [...prev.applicable_days, day],
    }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    // Same rules the server enforces (start required; end required unless
    // "Ongoing"; end after start) — checked here first so the owner gets
    // inline messages next to the fields instead of a generic error.
    const check = dealFormSchema.safeParse(form);
    if (!check.success) {
      const errors = fieldErrorsFromZod(check.error);
      setFieldErrors(errors);
      const firstKey = ["title", "start_at", "end_at"].find((k) => errors[k]);
      if (firstKey) {
        const id = { title: "deal-title", start_at: "deal-start", end_at: "deal-end" }[firstKey];
        document.getElementById(id as string)?.focus();
      }
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      // Same payload for create and edit: the form always manages every
      // field, so an edit is a full replacement. Dates are already known to
      // be valid here (start set; end set or Ongoing ticked).
      const result =
        editing === "new"
          ? await createLocationDealAction(locationId, form)
          : await updateLocationDealAction(locationId, editing as number, form);
      if (result.ok) {
        const saved = result.data;
        setDeals((prev) =>
          editing === "new"
            ? [saved, ...prev]
            : prev.map((d) => (d.id === saved.id ? saved : d))
        );
        closeForm();
      } else {
        setFormError(result.error);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(deal: Deal) {
    setListError(null);
    setPendingId(deal.id);
    try {
      const result = await updateLocationDealAction(locationId, deal.id, {
        is_active: !deal.is_active,
      });
      if (result.ok) {
        setDeals((prev) => prev.map((d) => (d.id === deal.id ? result.data : d)));
      } else {
        setListError(result.error);
      }
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(deal: Deal) {
    if (confirmingDeleteId !== deal.id) {
      setConfirmingDeleteId(deal.id);
      return;
    }
    setListError(null);
    setPendingId(deal.id);
    try {
      const result = await deleteLocationDealAction(locationId, deal.id);
      if (result.ok) {
        setDeals((prev) => prev.filter((d) => d.id !== deal.id));
        if (editing === deal.id) closeForm();
      } else {
        setListError(result.error);
      }
    } finally {
      setPendingId(null);
      setConfirmingDeleteId(null);
    }
  }

  const rowButton =
    "flex min-h-[44px] items-center gap-1.5 rounded-brand-control border border-brand-border bg-white px-3 text-xs font-semibold text-brand-ink transition hover:border-brand-ink-subtle disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <section
      id="deals"
      aria-labelledby="deals-heading"
      className={`${SECTION_ANCHOR_CLASS} rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="deals-heading"
          className="flex items-center gap-2 font-display text-xl font-bold text-brand-ink"
        >
          <TagIcon className="h-5 w-5 text-brand-ink-subtle" />
          Deals &amp; specials
        </h2>
        {editing === null && (
          <button
            type="button"
            onClick={openCreate}
            className="flex min-h-[44px] items-center justify-center gap-2 rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover"
          >
            <PlusIcon className="h-4 w-4" />
            Add a deal
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-brand-ink-muted">
        Free for every listing. Signed-in diners see the full deal; everyone else just sees
        &ldquo;Deal(s) available today&rdquo; on the restaurant&apos;s card and page.
      </p>

      {editing !== null && (
        <form
          onSubmit={handleSubmit}
          noValidate
          className="mt-4 flex flex-col gap-4 rounded-brand-control border border-brand-border bg-brand-bg p-4"
        >
          <h3 className="font-display text-base font-semibold text-brand-ink">
            {editing === "new" ? "New deal" : "Edit deal"}
          </h3>

          <div>
            <label htmlFor="deal-type" className={labelClass}>
              Type
            </label>
            <select
              id="deal-type"
              value={form.deal_type}
              onChange={(e) => patchForm({ deal_type: e.target.value as DealType })}
              className={`${inputClass} min-h-[44px]`}
            >
              <option value="deal">Deal — time-limited offer</option>
              <option value="special">Special — a standing offer (e.g. weekly special)</option>
            </select>
          </div>

          <div>
            <label htmlFor="deal-title" className={labelClass}>
              Title
            </label>
            <input
              id="deal-title"
              type="text"
              required
              aria-required="true"
              aria-invalid={fieldErrors.title ? true : undefined}
              aria-describedby={fieldErrors.title ? "deal-title-error" : undefined}
              maxLength={DEAL_TITLE_MAX_LENGTH}
              value={form.title}
              onChange={(e) => patchForm({ title: e.target.value })}
              placeholder="e.g. Lunch buffet $12.99"
              className={inputClass}
            />
            {fieldErrors.title && (
              <p id="deal-title-error" role="alert" className={errorTextClass}>
                {fieldErrors.title}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="deal-description" className={labelClass}>
              Description <span className="font-normal text-brand-ink-subtle">(optional)</span>
            </label>
            <textarea
              id="deal-description"
              rows={3}
              maxLength={DEAL_DESCRIPTION_MAX_LENGTH}
              value={form.description}
              onChange={(e) => patchForm({ description: e.target.value })}
              placeholder="Details, conditions, what's included..."
              className={inputClass}
            />
          </div>

          <fieldset>
            <legend className={labelClass}>Days offered</legend>
            <p className="mt-0.5 text-xs text-brand-ink-subtle">
              {form.applicable_days.length === 0
                ? "No day selected — offered every day."
                : "Only on the selected days."}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {DAY_NAMES.map((name, day) => {
                const on = form.applicable_days.includes(day);
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    aria-label={name}
                    onClick={() => toggleDay(day)}
                    className={
                      on
                        ? "min-h-[44px] min-w-[44px] rounded-brand-pill bg-brand-ink px-3 text-sm font-medium text-brand-bg transition"
                        : "min-h-[44px] min-w-[44px] rounded-brand-pill bg-brand-chip px-3 text-sm font-medium text-brand-chip-ink transition hover:bg-brand-chip/80"
                    }
                  >
                    {DAY_ABBREVIATIONS[day]}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {legacyStartNote && (
            <p className="rounded-brand-control bg-brand-chip px-3 py-2.5 text-xs text-brand-ink-muted">
              This deal was created before start dates were required, so we filled in the day it
              was created. Change it if that&apos;s not right, then save.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="deal-start" className={labelClass}>
                Starts <span className="font-normal text-brand-ink-subtle">(required)</span>
              </label>
              <input
                id="deal-start"
                type="datetime-local"
                required
                aria-required="true"
                aria-invalid={fieldErrors.start_at ? true : undefined}
                aria-describedby={fieldErrors.start_at ? "deal-start-error" : undefined}
                value={form.start_at}
                onChange={(e) => patchForm({ start_at: e.target.value })}
                className={`${inputClass} min-h-[44px]`}
              />
              {fieldErrors.start_at && (
                <p id="deal-start-error" role="alert" className={errorTextClass}>
                  {fieldErrors.start_at}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="deal-end" className={labelClass}>
                Ends{" "}
                <span className="font-normal text-brand-ink-subtle">
                  {form.ongoing ? "(none — ongoing)" : "(required)"}
                </span>
              </label>
              <input
                id="deal-end"
                type="datetime-local"
                required={!form.ongoing}
                aria-required={!form.ongoing}
                disabled={form.ongoing}
                aria-invalid={fieldErrors.end_at ? true : undefined}
                aria-describedby={fieldErrors.end_at ? "deal-end-error" : undefined}
                value={form.ongoing ? "" : form.end_at}
                onChange={(e) => patchForm({ end_at: e.target.value })}
                className={`${inputClass} min-h-[44px] disabled:cursor-not-allowed disabled:bg-brand-chip disabled:opacity-60`}
              />
              {fieldErrors.end_at && (
                <p id="deal-end-error" role="alert" className={errorTextClass}>
                  {fieldErrors.end_at}
                </p>
              )}
            </div>
          </div>

          <label className="flex min-h-[44px] items-center gap-2 text-sm text-brand-ink">
            <input
              type="checkbox"
              checked={form.ongoing}
              onChange={(e) =>
                patchForm(e.target.checked ? { ongoing: true, end_at: "" } : { ongoing: false })
              }
              className="h-4 w-4 accent-brand-accent"
            />
            Ongoing (no end date) — runs until you turn it off
          </label>
          <p className="-mt-2 text-xs text-brand-ink-subtle">
            Times use this device&apos;s timezone. For something like &ldquo;every Tuesday&rdquo;,
            pick the Tuesday chip above, a start date, and tick Ongoing.
          </p>

          <label className="flex min-h-[44px] items-center gap-2 text-sm text-brand-ink">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => patchForm({ is_active: e.target.checked })}
              className="h-4 w-4 accent-brand-accent"
            />
            Active (visible to diners when it applies today)
          </label>

          {formError && (
            <p className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
              {formError}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving}
              className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : editing === "new" ? "Add deal" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border bg-white px-5 text-sm font-semibold text-brand-ink transition hover:border-brand-ink-subtle disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {deals.length === 0 && editing === null ? (
        <p className="mt-4 rounded-brand-control border border-dashed border-brand-border px-4 py-6 text-center text-sm text-brand-ink-subtle">
          No deals yet. Add one to show a &ldquo;Deal(s) available today&rdquo; badge on this
          restaurant.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-brand-border rounded-brand-control border border-brand-border empty:hidden">
          {deals.map((deal) => {
            const busy = pendingId === deal.id;
            return (
              <li key={deal.id} className="flex flex-col gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-brand-pill bg-brand-accent/10 px-2 py-0.5 text-xs font-semibold text-brand-accent">
                      {deal.deal_type === "special" ? "Special" : "Deal"}
                    </span>
                    <span
                      className={
                        deal.is_active
                          ? "rounded-brand-pill bg-brand-success-bg px-2 py-0.5 text-xs font-semibold text-brand-success"
                          : "rounded-brand-pill bg-brand-chip px-2 py-0.5 text-xs font-semibold text-brand-ink-subtle"
                      }
                    >
                      {deal.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <p className="mt-1.5 break-words text-sm font-semibold text-brand-ink">
                    {deal.title}
                  </p>
                  {deal.description && (
                    <p className="mt-0.5 whitespace-pre-line break-words text-sm text-brand-ink-muted">
                      {deal.description}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-brand-ink-subtle">
                    {formatDealDays(deal.applicable_days)} ·{" "}
                    {formatDealDateRange(deal.start_at, deal.end_at)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(deal)}
                    disabled={busy || editing !== null}
                    className={rowButton}
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleActive(deal)}
                    disabled={busy}
                    className={rowButton}
                  >
                    {deal.is_active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(deal)}
                    disabled={busy}
                    className={
                      confirmingDeleteId === deal.id
                        ? "flex min-h-[44px] items-center gap-1.5 rounded-brand-control bg-brand-closed px-3 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        : "flex min-h-[44px] items-center gap-1.5 rounded-brand-control border border-brand-closed px-3 text-xs font-semibold text-brand-closed transition hover:bg-brand-closed-bg disabled:cursor-not-allowed disabled:opacity-60"
                    }
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                    {busy && confirmingDeleteId === deal.id
                      ? "Deleting..."
                      : confirmingDeleteId === deal.id
                        ? "Confirm — delete permanently"
                        : "Delete"}
                  </button>
                  {confirmingDeleteId === deal.id && (
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(null)}
                      className="min-h-[44px] px-2 text-xs font-medium text-brand-ink-subtle underline"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {listError && (
        <p className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
          {listError}
        </p>
      )}
    </section>
  );
}
