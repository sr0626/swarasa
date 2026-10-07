"use client";

// Renders a server timestamp (ISO 8601, UTC) in the VIEWER's local timezone.
// The server render and first client render show a deterministic UTC string
// (no hydration mismatch); an effect swaps in the local-time string after
// mount. The machine-readable value stays on `<time dateTime>`.
import { useEffect, useState } from "react";
import { formatLocalDateTime, formatUtcDateTime } from "@/lib/formatDateTime";

export default function LocalDateTime({
  iso,
  className,
}: {
  iso: string;
  className?: string;
}) {
  const [text, setText] = useState(() => formatUtcDateTime(iso));

  useEffect(() => {
    setText(formatLocalDateTime(iso));
  }, [iso]);

  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}
