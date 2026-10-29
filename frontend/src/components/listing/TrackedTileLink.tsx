"use client";

// A `next/link` that, when `track` is provided, also reports the click to the
// viewer's activity history (registered users only — callers pass `track`
// only for them; the route handler and backend re-check the role anyway).
// The report is a fire-and-forget beacon (lib/activity/tileClick.ts), so it
// never delays or blocks navigation. With no `track` this is exactly a plain
// `<Link>`.
import Link from "next/link";
import type { ReactNode } from "react";
import { trackTileClick } from "@/lib/activity/tileClick";
import { trackLocationEvent } from "@/lib/analytics/track";
import type { TileClickInput } from "@/types/userActivity";

interface TrackedTileLinkProps {
  href: string;
  className?: string;
  /** Accessible name override (for a link whose content is several nodes). */
  "aria-label"?: string;
  /** Omit for anyone who is not a signed-in registered_user. */
  track?: TileClickInput;
  /** The location this tile opens. When set, the click also bumps that
   * location's anonymous "tile clicks" counter for the owner Insights view
   * (lib/analytics/track.ts) — for EVERY viewer, signed in or not; no
   * identity is sent or stored. Independent of `track` (per-user history). */
  locationId?: number | null;
  children: ReactNode;
}

export default function TrackedTileLink({
  href,
  className,
  "aria-label": ariaLabel,
  track,
  locationId,
  children,
}: TrackedTileLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      aria-label={ariaLabel}
      onClick={
        track || locationId
          ? () => {
              if (track) trackTileClick(track);
              if (locationId) trackLocationEvent(locationId, "tile_click");
            }
          : undefined
      }
    >
      {children}
    </Link>
  );
}
