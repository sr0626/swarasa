// Compact weekly hours list for the sidebar info card, rendered from
// `LocationDetail.hours` (docs/API_CONTRACTS.md "GET /locations/{id}" —
// day_of_week 0=Monday..6=Sunday). Seven short rows, today highlighted.
// A day that is missing or `is_closed: null` is "hours unknown" and is
// simply left out rather than guessed or shown as a placeholder (same
// "never a Hours-unknown label" stance as OpenStatusBadge); if no day has
// known hours the whole list is omitted.
import { formatShortTime } from "@/lib/formatHours";
import type { LocationHour } from "@/types/location";

const DAYS = [
  { short: "Mon", full: "Monday" },
  { short: "Tue", full: "Tuesday" },
  { short: "Wed", full: "Wednesday" },
  { short: "Thu", full: "Thursday" },
  { short: "Fri", full: "Friday" },
  { short: "Sat", full: "Saturday" },
  { short: "Sun", full: "Sunday" },
];

/** Known-hours label for a day, or null when unknown. */
function describeDay(hour: LocationHour | undefined): string | null {
  if (!hour || hour.is_closed === null) return null;
  if (hour.is_closed) return "Closed";
  if (hour.open_time && hour.close_time) {
    return `${formatShortTime(hour.open_time)} – ${formatShortTime(hour.close_time)}`;
  }
  return null;
}

export default function RestaurantHours({
  hours,
  todayIndex,
}: {
  hours: LocationHour[];
  /** 0=Monday..6=Sunday in the location's timezone, or null. */
  todayIndex: number | null;
}) {
  const rows = DAYS.map((day, index) => ({
    day,
    index,
    label: describeDay(hours.find((h) => h.day_of_week === index)),
  })).filter((row) => row.label !== null);

  if (rows.length === 0) return null;

  return (
    <div>
      <h2 className="font-display text-base font-semibold text-brand-ink">Hours</h2>
      <ul className="mt-2 flex flex-col gap-0.5 text-sm">
        {rows.map(({ day, index, label }) => {
          const isToday = index === todayIndex;
          return (
            <li
              key={day.short}
              aria-current={isToday ? "date" : undefined}
              className={`flex items-center justify-between rounded-brand-control px-2.5 py-1.5 ${
                isToday ? "bg-brand-chip font-semibold text-brand-ink" : "text-brand-ink-muted"
              }`}
            >
              <span>
                <span aria-hidden="true">{day.short}</span>
                <span className="sr-only">{isToday ? `${day.full} (today)` : day.full}</span>
              </span>
              <span>{label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
