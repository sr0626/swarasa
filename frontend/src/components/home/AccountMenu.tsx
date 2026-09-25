"use client";

// Signed-in account dropdown for the shared TopBar (components/home/TopBar.tsx)
// — docs/PROJECT_PLAN.csv "Signed-in account dropdown in site header". Built
// as an accessible disclosure (WAI-ARIA "menu button" pattern) rather than a
// third-party dropdown package, matching frontend/CLAUDE.md's Tailwind-only,
// no-new-dependency-without-checking-it-fits posture and the small existing
// `components/ui/` surface (no dropdown/menu primitive existed there yet to
// reuse — checked before building this).
//
// Rendered on every page (TopBar is shared across "/", "/login", "/search",
// "/about", "/contact", "/terms", "/signup", "/forgot-password", "/account")
// so it deliberately does NOT hide itself at any breakpoint — Logout in
// particular has to stay reachable on a 375px viewport. (The top bar's mobile
// menu button, TopBarNav.tsx, only holds navigation links; account items and
// Logout live here, always.)
import { useEffect, useId, useRef, useState, type FocusEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "@aws-amplify/auth";
import { ensureAmplifyConfigured } from "@/lib/auth/amplifyClient";
import { stopSessionKeepAlive } from "@/lib/auth/sessionKeepAlive";
import { announceMenuOpen, onOtherMenuOpen } from "@/lib/nav/exclusiveMenu";
import { ChevronDownIcon } from "@/components/ui/icons";
import type { UserRole } from "@/types/auth";

interface MenuItem {
  key: string;
  label: string;
  href?: string;
  onSelect?: () => void;
}

/**
 * Role-aware leading items (everything before Security/Logout, which are
 * the same for every role). `/account` is a single page with in-page anchor
 * sections per role view (components/account/*View.tsx) — owner's is
 * `id="profile"` (components/account/OwnerAccountView.tsx, also backing
 * OWNER_NAV_ITEMS' `/account#profile` in components/console/navItems.ts).
 *
 * owner/manager: two items, "Account" (top of page) and "Profile" (the
 * `#profile` section). Manager gets the exact same links as owner even
 * though components/account/ManagerAccountView.tsx doesn't render a
 * matching `id="profile"` section yet (no ManagerShell/nav items exist
 * yet, per OwnerShell.tsx's own comment) — `/account#profile` degrades to
 * a plain `/account` load with no anchor to scroll to until that lands, so
 * this needs no follow-up change once it does.
 *
 * registered_user: one item relabeled "My Favorites" — `/account` for a
 * diner renders the followed-restaurants grid (components/account/
 * DinerAccountView.tsx, PR #132), so "Profile" undersells what's there.
 *
 * admin: unchanged "Profile" — components/account/AdminAccountView.tsx
 * has no in-page anchor sections and AdminShell already provides its own
 * console navigation, so there's nothing to split.
 */
function leadingItemsFor(role: UserRole | null): MenuItem[] {
  if (role === "owner" || role === "manager") {
    return [
      { key: "account", label: "Account", href: "/account" },
      { key: "profile", label: "Profile", href: "/account#profile" },
    ];
  }
  if (role === "registered_user") {
    return [{ key: "profile", label: "My Favorites", href: "/account" }];
  }
  // admin, and any unexpected/null role — same single-item fallback as before.
  return [{ key: "profile", label: "Profile", href: "/account" }];
}

export default function AccountMenu({
  greetingName,
  role,
}: {
  greetingName: string;
  role: UserRole | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | HTMLButtonElement | null>>([]);

  // Only one top-bar menu open at a time: announce this one, close on another's.
  const menuId = useId();
  useEffect(() => {
    if (open) announceMenuOpen(menuId);
  }, [open, menuId]);
  useEffect(() => onOtherMenuOpen(menuId, () => setOpen(false)), [menuId]);

  /**
   * Logout (docs/PROJECT_PLAN.csv row, task brief): stop the silent-refresh
   * loop FIRST so a stale timer can't fire a re-auth attempt after the
   * cookies it would refresh are already gone, then clear the server-side
   * session cookies (the actual source of truth `getServerSession()`
   * reads), then best-effort clear Amplify's own in-memory Cognito state.
   * Amplify's `signOut()` needs an active in-memory session to have
   * anything to clear — after a hard reload/new tab it usually has none
   * (lib/auth/sessionKeepAlive.ts's documented gap), so this is wrapped in
   * its own try/catch and never blocks the redirect: the httpOnly cookie
   * clear is what actually ends the session.
   */
  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    stopSessionKeepAlive();

    try {
      await fetch("/api/auth/session", { method: "DELETE" });
    } catch {
      // Best-effort — even if this network call fails, we still navigate
      // away and let the user retry; we never leave the menu stuck open.
    }

    try {
      ensureAmplifyConfigured();
      await signOut();
    } catch {
      // No local Amplify session to sign out of, or Amplify wasn't
      // configured in this tab at all — nothing left to clean up
      // client-side, the server-side cookie clear above is what matters.
    }

    setOpen(false);
    setLoggingOut(false);
    router.push("/");
    router.refresh();
  }

  const items: MenuItem[] = [
    ...leadingItemsFor(role),
    { key: "security", label: "Security", href: "/account/security" },
    { key: "logout", label: loggingOut ? "Signing out…" : "Logout", onSelect: handleLogout },
  ];

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const current = itemRefs.current.findIndex((el) => el === document.activeElement);
        const count = itemRefs.current.length;
        const next =
          e.key === "ArrowDown"
            ? (current + 1 + count) % count
            : (current - 1 + count) % count;
        itemRefs.current[next]?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    // Move focus onto the first item as soon as the menu opens, so
    // keyboard users land inside it immediately (Enter/Space already
    // opened it via the native <button>).
    itemRefs.current[0]?.focus();

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  /** Closes the menu once focus moves somewhere outside it (e.g. Tab past the last item). */
  function handleBlur(e: FocusEvent<HTMLDivElement>) {
    if (!containerRef.current?.contains(e.relatedTarget as Node | null)) {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative" onBlur={handleBlur}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-brand-pill border border-brand-border bg-white px-2.5 text-sm font-semibold text-brand-ink transition hover:bg-brand-chip sm:px-4"
      >
        {/* "Hello, " is visual clutter on a phone (the 375px header is full once
            the menu button sits beside this pill), so it is screen-reader-only
            there; the name itself still shows, truncated. */}
        <span className="max-w-[48px] truncate sm:max-w-[180px]">
          <span className="max-sm:sr-only">Hello, </span>
          {greetingName}
        </span>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 text-brand-ink-subtle transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-brand-control border border-brand-border bg-white shadow-brand-card-hover"
        >
          {items.map((item, index) =>
            item.href ? (
              <Link
                key={item.key}
                href={item.href}
                role="menuitem"
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                onClick={() => setOpen(false)}
                className="flex min-h-[44px] items-center px-4 text-sm font-medium text-brand-ink transition hover:bg-brand-chip focus:bg-brand-chip focus:outline-none"
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                disabled={loggingOut}
                onClick={item.onSelect}
                className="flex min-h-[44px] w-full items-center px-4 text-left text-sm font-medium text-brand-closed transition hover:bg-brand-closed-bg focus:bg-brand-closed-bg focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
