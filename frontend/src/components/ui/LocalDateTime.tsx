"use client";

// Renders a backend timestamp in the VIEWER's timezone with an explicit zone
// label ("Sep 24, 2026, 10:45 PM CDT"). The one component every admin/console
// screen uses for timestamps -- see lib/formatDateTime.ts for why formatting
// must happen in the browser (Server Components run in UTC).
//
// Hydration-safe: the server render and the browser's first render both
// format in UTC (labelled "UTC", so never mistaken for local time); an effect
// then switches to the browser's own timezone. No mismatch warning, and the
// text is correct even before/without JavaScript, just in UTC.
import { useEffect, useState } from "react";
import {
  browserTimeZone,
  formatInstant,
  parseInstant,
  type DateTimeVariant,
} from "@/lib/formatDateTime";

interface LocalDateTimeProps {
  /** ISO timestamp from the API (`Z`/offset; an offset-less value is read as UTC). */
  value: string | null | undefined;
  variant?: DateTimeVariant;
  /** Text for a missing/unparseable value. */
  fallback?: string;
  className?: string;
}

export default function LocalDateTime({
  value,
  variant = "datetime",
  fallback = "—",
  className,
}: LocalDateTimeProps) {
  const [timeZone, setTimeZone] = useState<string>("UTC");
  useEffect(() => {
    setTimeZone(browserTimeZone() ?? "UTC");
  }, []);

  const parsed = parseInstant(value);
  const text = formatInstant(value, { variant, timeZone });
  if (!parsed || text === null) return <span className={className}>{fallback}</span>;
  return (
    <time dateTime={parsed.toISOString()} className={className}>
      {text}
    </time>
  );
}
