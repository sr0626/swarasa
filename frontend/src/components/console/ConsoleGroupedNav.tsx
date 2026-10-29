"use client";

// Grouped console menu (opt-in via `navMenu` on ConsoleShell; the flat menu in
// ConsoleSidebarNav.tsx is unchanged for consoles that don't use it).
//
// From `lg`: a vertical card -- standalone top items, then one collapsible
// section per group (header BUTTON with aria-expanded/aria-controls). The group
// holding the active page is open; others follow `defaultOpen`; the user's own
// open/close choices persist in localStorage.
//
// Below `lg`: a tall accordion would fight the compact phone layout, so it is a
// TWO-LEVEL pill control instead -- row 1: the top items + one pill per group,
// row 2: the pills of the selected group. Group pills are plain toggle buttons
// (`aria-pressed`), not a tablist: simpler, and fully operable by Tab/Enter/Space
// without a roving-tabindex arrow-key implementation. Tapping one never
// navigates; it only switches row 2. Both rows scroll horizontally inside their
// own container (edge fades hint at overflow) so the page never overflows.
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import ConsoleNavItemRow from "@/components/console/ConsoleNavItemRow";
import { useScrollRow } from "@/components/console/useScrollRow";
import { activeNavHref, flattenNavMenu, groupForPath } from "@/components/console/navItems";
import type { ConsoleNavGroup, ConsoleNavMenu } from "@/components/console/navItems";
import { ChevronDownIcon } from "@/components/ui/icons";
import {
  navGroupStorageKey,
  parseStoredGroupState,
  resolveOpenGroups,
  resolveSelectedGroupId,
} from "@/lib/ui/navGroupState";
import type { StoredGroupState } from "@/lib/ui/navGroupState";

const FOCUS = "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent";

/** One contained, horizontally scrolling pill row with edge fades (phone only). */
function PillRow({
  resetKey,
  markerSelector,
  children,
}: {
  resetKey: string;
  markerSelector: string;
  children: ReactNode;
}) {
  const { ref, edges, onScroll } = useScrollRow<HTMLDivElement>(resetKey, markerSelector);
  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={onScroll}
        className="overflow-x-auto py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-brand-bg to-transparent transition-opacity ${
          edges.left ? "opacity-100" : "opacity-0"
        }`}
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-brand-bg to-transparent transition-opacity ${
          edges.right ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}

/** Group header + collapsible item list in the desktop card. */
function DesktopGroup({
  group,
  open,
  containsActive,
  current,
  onToggle,
}: {
  group: ConsoleNavGroup;
  open: boolean;
  containsActive: boolean;
  current: string | null;
  onToggle: () => void;
}) {
  const panelId = useId();
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-brand-control px-4 text-xs font-bold uppercase tracking-wider text-brand-ink-muted transition hover:bg-brand-chip hover:text-brand-ink ${FOCUS}`}
      >
        <span className="flex items-center gap-2">
          {group.title}
          {!open && containsActive && (
            <>
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-accent" />
              <span className="sr-only">(current section)</span>
            </>
          )}
        </span>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 motion-safe:transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div id={panelId} hidden={!open} className={open ? "" : "hidden"}>
        <ul className="flex flex-col gap-1 pb-1">
          {group.items.map((item) => (
            <ConsoleNavItemRow key={item.href} item={item} active={item.href === current} />
          ))}
        </ul>
      </div>
    </li>
  );
}

function readStored(key: string, groups: ReadonlyArray<ConsoleNavGroup>): StoredGroupState {
  try {
    return parseStoredGroupState(window.localStorage.getItem(key), groups);
  } catch {
    return {}; // storage blocked / unavailable
  }
}

function writeStored(key: string, value: StoredGroupState): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked / full: the choice simply isn't remembered
  }
}

export default function ConsoleGroupedNav({ menu, label }: { menu: ConsoleNavMenu; label: string }) {
  const { top, groups } = menu;
  const pathname = usePathname() ?? "";
  const current = activeNavHref(pathname, flattenNavMenu(menu));
  const activeGroupId = groupForPath(pathname, groups)?.id ?? null;
  const storageKey = navGroupStorageKey(label);
  const itemsRowId = useId();

  // Desktop open/close. Server render and first client render use the defaults
  // only (no storage); stored choices are applied in the mount effect below.
  const [open, setOpen] = useState<Record<string, boolean>>(() => resolveOpenGroups(groups, activeGroupId));
  const manualRef = useRef<StoredGroupState>({});
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      manualRef.current = readStored(storageKey, groups);
      setOpen(resolveOpenGroups(groups, activeGroupId, manualRef.current));
      return;
    }
    // Navigated into another group: make sure it is visible.
    if (activeGroupId !== null) {
      setOpen((prev) => (prev[activeGroupId] ? prev : { ...prev, [activeGroupId]: true }));
    }
  }, [activeGroupId, groups, storageKey]);

  const toggle = (id: string): void => {
    const next = !open[id];
    manualRef.current = { ...manualRef.current, [id]: next };
    writeStored(storageKey, manualRef.current);
    setOpen((prev) => ({ ...prev, [id]: next }));
  };

  // Phone: the group whose items fill row 2. A tap overrides it only for the
  // current path, so the selection snaps back to the page's group on navigation.
  const [pick, setPick] = useState<{ path: string; id: string } | null>(null);
  const picked = pick && pick.path === pathname ? pick.id : null;
  const selectedId = resolveSelectedGroupId(groups, activeGroupId, picked);
  const selected = groups.find((g) => g.id === selectedId) ?? null;

  return (
    <nav aria-label={label}>
      {/* Phone: two-level pill control. */}
      <div className="lg:hidden">
        <PillRow resetKey={`${selectedId}|${current}|g`} markerSelector='[aria-current="page"], [aria-pressed="true"]'>
          <ul className="flex gap-2 px-1">
            {top.map((item) => (
              <ConsoleNavItemRow key={item.href} item={item} active={item.href === current} showSubItems={false} />
            ))}
            {groups.map((g) => {
              const isSelected = g.id === selectedId;
              return (
                <li key={g.id} className="shrink-0">
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-controls={itemsRowId}
                    onClick={() => setPick({ path: pathname, id: g.id })}
                    className={`flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-brand-pill border px-4 text-sm font-semibold transition ${FOCUS} ${
                      isSelected
                        ? "border-brand-ink bg-brand-chip text-brand-ink"
                        : "border-brand-border bg-white text-brand-ink-muted hover:bg-brand-chip hover:text-brand-ink"
                    }`}
                  >
                    {g.title}
                    {g.id === activeGroupId && (
                      <>
                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-accent" />
                        <span className="sr-only">(current section)</span>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </PillRow>
        {selected && (
          <PillRow resetKey={`${selectedId}|${current}|i`} markerSelector='[aria-current="page"]'>
            <ul id={itemsRowId} aria-label={`${selected.title} pages`} className="flex gap-2 px-1">
              {selected.items.map((item) => (
                <ConsoleNavItemRow key={item.href} item={item} active={item.href === current} showSubItems={false} />
              ))}
            </ul>
          </PillRow>
        )}
      </div>

      {/* Desktop: vertical card with collapsible groups. */}
      <div className="hidden rounded-brand-card border border-brand-border bg-white p-2 shadow-brand-card lg:block">
        <ul className="flex flex-col gap-1">
          {top.map((item) => (
            <ConsoleNavItemRow key={item.href} item={item} active={item.href === current} />
          ))}
          {groups.map((g) => (
            <DesktopGroup
              key={g.id}
              group={g}
              open={open[g.id] ?? false}
              containsActive={g.id === activeGroupId}
              current={current}
              onToggle={() => toggle(g.id)}
            />
          ))}
        </ul>
      </div>
    </nav>
  );
}
