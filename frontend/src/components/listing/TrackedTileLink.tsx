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
import type { TileClickInput } from "@/types/userActivity";

interface TrackedTileLinkProps {
  href: string;
  className?: string;
  /** Omit for anyone who is not a signed-in registered_user. */
  track?: TileClickInput;
  children: ReactNode;
}

export default function TrackedTileLink({
  href,
  className,
  track,
  children,
}: TrackedTileLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      onClick={track ? () => trackTileClick(track) : undefined}
    >
      {children}
    </Link>
  );
}
