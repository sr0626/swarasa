"use client";

// Weekly hours editor — PUT /locations/{id}/hours, full week replacement
// (docs/API_CONTRACTS.md "PUT /locations/{id}/hours"). day_of_week is
// 0=Monday..6=Sunday (docs/DATA_MODEL.md "restaurant_hours").
//
// HTML <input type="time"> values are "HH:MM" with no seconds, but the
// contract's open_time/close_time are "HH:MM:SS" — converted at the
// state <-> payload boundary below, never sent/displayed inconsistently.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateLocationHoursAction } from "@/app/portal/locations/[id]/actions";
import { ClockIcon } from "@/components/ui/icons";
import type { DayOfWeek, LocationHour } from "@/types/location";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

interface DayFormState {
  day_of_week: DayOfWeek;
  is_closed: boolean;
  open_time: string;
  close_time: string;
}

/** "11:00:00" -> "11:00" for the <input type="time"> value attribute. */
function toTimeInputValue(time: string | undefined): string {
  if (!time) return "";
  return time.slice(0, 5);
}

/** "11:00" -> "11:00:00" for the PUT payload. */
function toApiTime(time: string): string | undefined {
  if (!time) return undefined;
  return `${time}:00`;
}

function buildInitialState(hours: LocationHour[]): DayFormState[] {
  return Array.from({ length: 7 }, (_, day) => {
    const existing = hours.find((h) => h.day_of_week === day);
    return {
      day_of_week: day as DayOfWeek,
      // A day with no seeded row ("hours unknown") starts as not-closed
      // with blank times, same as a day the owner hasn't filled in yet —
      // this form always writes a real value on save, per the "full week
      // replacement" contract, rather than re-submitting `null`.
      is_closed: existing?.is_closed ?? false,
      open_time: toTimeInputValue(existing?.open_time),
      close_time: toTimeInputValue(existing?.close_time),
    };
  });
}

export default function LocationHoursEditor({
  locationId,
  hours,
}: {
  locationId: number;
  hours: LocationHour[];
}) {
  const router = useRouter();
  const [days, setDays] = useState<DayFormState[]>(buildInitialState(hours));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function updateDay(index: number, patch: Partial<DayFormState>) {
    setDays((prev) => prev.map((day, i) => (i === index ? { ...day, ...patch } : day)));
    setSaved(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const payload = {
      hours: days.map((day) => ({
        day_of_week: day.day_of_week,
        is_closed: day.is_closed,
        open_time: day.is_closed ? undefined : toApiTime(day.open_time),
        close_time: day.is_closed ? undefined : toApiTime(day.close_time),
      })),
    };

    setSaving(true);
    try {
      const result = await updateLocationHoursAction(locationId, payload);
      if (result.ok) {
        setDays(buildInitialState(result.data));
        setSaved(true);
        // Re-render the page around us so the setup checklist reflects the
        // new hours.
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
      aria-labelledby="hours-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <h2
        id="hours-heading"
        className="flex items-center gap-2 font-display text-xl font-bold text-brand-ink"
      >
        <ClockIcon className="h-5 w-5 text-brand-ink-subtle" />
        Hours
      </h2>

      <form onSubmit={handleSubmit} className="mt-4">
        <ul className="divide-y divide-brand-border rounded-brand-control border border-brand-border">
          {days.map((day, index) => (
            <li key={day.day_of_week} className="flex flex-wrap items-center gap-3 p-3">
              <span className="w-28 shrink-0 text-sm font-semibold text-brand-ink">
                {DAY_NAMES[day.day_of_week]}
              </span>

              <label className="flex min-h-[44px] items-center gap-2 text-sm text-brand-ink-muted">
                <input
                  type="checkbox"
                  checked={day.is_closed}
                  onChange={(e) => updateDay(index, { is_closed: e.target.checked })}
                  className="h-4 w-4 accent-brand-accent"
                />
                Closed
              </label>

              {!day.is_closed && (
                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor={`open-${day.day_of_week}`}>
                    {DAY_NAMES[day.day_of_week]} opening time
                  </label>
                  <input
                    id={`open-${day.day_of_week}`}
                    type="time"
                    required
                    value={day.open_time}
                    onChange={(e) => updateDay(index, { open_time: e.target.value })}
                    className="rounded-brand-control border border-brand-border bg-white px-2 py-1.5 text-sm text-brand-ink focus:border-brand-accent focus:outline-none"
                  />
                  <span className="text-brand-ink-subtle">to</span>
                  <label className="sr-only" htmlFor={`close-${day.day_of_week}`}>
                    {DAY_NAMES[day.day_of_week]} closing time
                  </label>
                  <input
                    id={`close-${day.day_of_week}`}
                    type="time"
                    required
                    value={day.close_time}
                    onChange={(e) => updateDay(index, { close_time: e.target.value })}
                    className="rounded-brand-control border border-brand-border bg-white px-2 py-1.5 text-sm text-brand-ink focus:border-brand-accent focus:outline-none"
                  />
                </div>
              )}
            </li>
          ))}
        </ul>

        {error && (
          <p className="mt-4 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
            {error}
          </p>
        )}
        {saved && !error && (
          <p className="mt-4 rounded-brand-control bg-brand-success-bg px-3 py-2.5 text-sm text-brand-success">
            Hours saved.
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="mt-4 flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {saving ? "Saving..." : "Save hours"}
        </button>
      </form>
    </section>
  );
}
