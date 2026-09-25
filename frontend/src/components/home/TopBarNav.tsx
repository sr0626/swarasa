"use client";

// Role-aware navigation links for the shared top bar (TopBarShell.tsx).
//
// Client component only because the active link comes from `usePathname()` /
// `useSearchParams()` -- the shell is server-rendered (and is also rendered by
// app/error.tsx, a Client Component), so it can't know the current URL itself.
// The link SET is decided by the caller from the session role (TopBar.tsx
// already resolves it server-side; nothing here reads tokens or storage) via
// the pure helper in lib/nav/topBarLinks.ts.
//
// Two pieces, both driven by the same link list:
//   - TopBarDesktopNav: inline links in the middle of the bar, `lg:` and up.
//   - TopBarMobileNav: below `lg` a 44px menu button on the right of the bar
//     opens a full-width panel under the header (absolutely positioned, so
//     opening it never shifts page content). The header is only ~72px tall
//     with the logo + account pill already in it, so links can't sit inline
//     on a phone -- and a scrollable link row would hide half the links.
//
// `useSearchParams()` needs a Suspense boundary in Next 14 (otherwise it
// opts the whole page out of static rendering). Each piece wraps the
// param-reading part in <Suspense> with the SAME links as its fallback, just
// without active styling, so there is no layout shift when it resolves.
import { Suspense, useEffect, useId, useRef, useState, type FocusEvent } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { MenuIcon, XIcon } from "@/components/ui/icons";
import { announceMenuOpen, onOtherMenuOpen } from "@/lib/nav/exclusiveMenu";
import { isTopBarLinkActive, type TopBarLink } from "@/lib/nav/topBarLinks";

type Variant = "desktop" | "mobile";

const FOCUS_RING =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 focus-visible:ring-offset-brand-bg";

function linkClass(link: TopBarLink, active: boolean, variant: Variant): string {
  const base = `flex min-h-[44px] items-center whitespace-nowrap text-sm transition ${FOCUS_RING}`;
  if (link.cta) {
    // The header's one call to action -- same dark pill as before this redesign.
    return `${base} justify-center rounded-brand-pill bg-brand-ink px-5 font-semibold text-brand-bg hover:bg-brand-ink/90 ${
      variant === "mobile" ? "mt-1" : "ml-1"
    }`;
  }
  const shape = variant === "mobile" ? "rounded-brand-control px-3" : "rounded-brand-pill px-3";
  return `${base} ${shape} ${
    active
      ? "bg-brand-chip font-semibold text-brand-ink"
      : "font-medium text-brand-ink-muted hover:bg-brand-chip hover:text-brand-ink"
  }`;
}

function LinkList({
  links,
  variant,
  activeKeys,
  onNavigate,
}: {
  links: ReadonlyArray<TopBarLink>;
  variant: Variant;
  /** `null` = active state not known yet (Suspense fallback / first paint). */
  activeKeys: ReadonlySet<string> | null;
  onNavigate?: () => void;
}) {
  return (
    <ul className={variant === "desktop" ? "flex items-center gap-1" : "flex flex-col gap-1"}>
      {links.map((link) => {
        const active = activeKeys?.has(link.key) ?? false;
        return (
          <li key={link.key} className="flex flex-col">
            <Link
              href={link.href}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              className={linkClass(link, active, variant)}
            >
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Reads the URL (needs the Suspense boundary) and renders the list with active state. */
function ActiveLinkList({
  links,
  variant,
  onNavigate,
}: {
  links: ReadonlyArray<TopBarLink>;
  variant: Variant;
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const activeKeys = new Set(
    links.filter((l) => isTopBarLinkActive(l, pathname, searchParams)).map((l) => l.key),
  );
  return <LinkList links={links} variant={variant} activeKeys={activeKeys} onNavigate={onNavigate} />;
}

function Links(props: { links: ReadonlyArray<TopBarLink>; variant: Variant; onNavigate?: () => void }) {
  return (
    <Suspense fallback={<LinkList {...props} activeKeys={null} />}>
      <ActiveLinkList {...props} />
    </Suspense>
  );
}

/** Inline links, `lg:` and up. Sits in the flexible middle of the header row. */
export function TopBarDesktopNav({ links }: { links: ReadonlyArray<TopBarLink> }) {
  return (
    <nav aria-label="Primary" className="hidden flex-1 justify-center lg:flex">
      <Links links={links} variant="desktop" />
    </nav>
  );
}

/** Menu button + dropdown panel, below `lg`. Renders inside the header's right-hand cluster. */
export function TopBarMobileNav({ links }: { links: ReadonlyArray<TopBarLink> }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Only one top-bar menu open at a time: announce this one, close on another's.
  const menuId = useId();
  useEffect(() => {
    if (open) announceMenuOpen(menuId);
  }, [open, menuId]);
  useEffect(() => onOtherMenuOpen(menuId, () => setOpen(false)), [menuId]);

  // Close on any navigation (including ones that don't go through a link
  // click here, e.g. browser back).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  /** Closes the panel once focus leaves the button + panel (e.g. Tab past the last link). */
  function handleBlur(e: FocusEvent<HTMLDivElement>) {
    if (!containerRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
  }

  return (
    // Deliberately NOT `relative`: the panel anchors to the (sticky, hence
    // positioned) <header>, so it spans the full bar width.
    <div ref={containerRef} className="lg:hidden" onBlur={handleBlur}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        className={`flex h-11 w-11 items-center justify-center rounded-brand-pill border border-brand-border bg-white text-brand-ink transition hover:bg-brand-chip ${FOCUS_RING}`}
      >
        {open ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
      </button>

      {open && (
        <nav
          id={panelId}
          aria-label="Primary"
          className="absolute inset-x-0 top-full max-h-[calc(100vh-4.5rem)] overflow-y-auto border-b border-brand-border bg-brand-bg px-4 py-3 shadow-brand-card-hover sm:px-6"
        >
          <div className="mx-auto max-w-6xl">
            <Links links={links} variant="mobile" onNavigate={() => setOpen(false)} />
          </div>
        </nav>
      )}
    </div>
  );
}
