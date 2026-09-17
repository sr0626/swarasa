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
// so it deliberately does NOT hide itself at the `sm:` breakpoint the way
// the signed-out "For Owners"/"Sign In" links do — Logout in particular has
// to stay reachable on a 375px viewport, since nothing else in this app
// (no hamburger nav) exposes it.
import { useEffect, useRef, useState, type FocusEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "@aws-amplify/auth";
import { ensureAmplifyConfigured } from "@/lib/auth/amplifyClient";
import { stopSessionKeepAlive } from "@/lib/auth/sessionKeepAlive";
import { ChevronDownIcon } from "@/components/ui/icons";

interface MenuItem {
  key: string;
  label: string;
  href?: string;
  onSelect?: () => void;
}

export default function AccountMenu({ greetingName }: { greetingName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | HTMLButtonElement | null>>([]);

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
    { key: "profile", label: "Profile", href: "/account" },
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
        className="flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-brand-pill border border-brand-border bg-white px-3 text-sm font-semibold text-brand-ink transition hover:bg-brand-chip sm:px-4"
      >
        <span className="max-w-[96px] truncate sm:max-w-[180px]">Hello, {greetingName}</span>
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
