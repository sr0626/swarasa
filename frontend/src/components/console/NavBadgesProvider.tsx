"use client";

// Holds the action-item badges for a console menu and hands them to the nav via
// context (ConsoleGroupedNav / ConsoleNavItemRow read `useNavBadges()`). With no
// provider (owner / manager consoles) the context is empty and nothing renders.
//
// Freshness: the initial badges come from the server render. A layout is not
// re-rendered on client-side navigation between sibling pages, so when the path
// changes the provider asks `refresh` (a Server Action) for newer ones. A failed
// refresh (null) keeps what is already shown -- never an error, never a flicker.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { EMPTY_NAV_BADGES } from "@/lib/ui/queueBadges";
import type { NavBadges } from "@/lib/ui/queueBadges";

const NavBadgesContext = createContext<NavBadges>(EMPTY_NAV_BADGES);

export function useNavBadges(): NavBadges {
  return useContext(NavBadgesContext);
}

export default function NavBadgesProvider({
  initial,
  refresh,
  children,
}: {
  /** Badges from the server render; null = counts unavailable (no badges). */
  initial: NavBadges | null;
  /** Re-fetch on navigation; resolves null when unavailable. */
  refresh?: () => Promise<NavBadges | null>;
  children: ReactNode;
}) {
  const [badges, setBadges] = useState<NavBadges>(initial ?? EMPTY_NAV_BADGES);
  const pathname = usePathname();
  const firstPath = useRef(pathname);

  // A new server render (e.g. router.refresh()) wins over what we hold.
  useEffect(() => {
    if (initial) setBadges(initial);
  }, [initial]);

  useEffect(() => {
    if (!refresh || firstPath.current === pathname) return;
    firstPath.current = pathname;
    let cancelled = false;
    refresh()
      .then((next) => {
        if (!cancelled && next) setBadges(next);
      })
      .catch(() => {
        // best-effort: keep the current badges
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, refresh]);

  return <NavBadgesContext.Provider value={badges}>{children}</NavBadgesContext.Provider>;
}
