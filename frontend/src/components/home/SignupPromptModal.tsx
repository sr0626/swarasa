"use client";

// Homepage "Get more from Swarasa" sign-up popup, for SIGNED-OUT visitors only.
//
// WHEN IT APPEARS: `HomePage` (a Server Component) passes `signedIn` from the
// same `getServerSession()` check TopBar uses; a signed-in account never mounts
// the timers at all. For a visitor the dialog opens after 10 s on the page, or
// earlier once they scroll past ~60% of the page height (whichever first).
// Chosen because it is the simplest robust pair: one timeout + one passive
// scroll listener, both cleared on unmount. It is postponed (re-tried when the
// field loses focus) while the visitor is typing in an input, and never shown
// when `navigator.webdriver` is true (Lighthouse / Playwright / Selenium).
//
// SEO / LCP / CLS: initial state is closed, so the server render and the first
// client render are both `null` -- no markup for crawlers, nothing to hydrate,
// nothing in the LCP path. It only ever appears as a `position: fixed` overlay
// seconds later, so it moves no page content. Locking body scroll compensates
// for the vanished scrollbar so desktop content does not jump.
//
// DISMISSAL: Close (X), "Maybe later", Escape, backdrop click, and following
// either link all count. The timestamp is stored in localStorage for 14 days
// (lib/ui/signupPrompt.ts); every storage access is try/catch'd, and an
// in-memory module flag guarantees at most one showing per page session even
// when storage is blocked.
//
// A11y: role="dialog" aria-modal, labelled + described, focus moves in and is
// restored on close, Tab is trapped, no required animation (so nothing to gate
// on prefers-reduced-motion), icons are aria-hidden.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import BenefitIcon from "@/components/home/BenefitIcon";
import { XIcon } from "@/components/ui/icons";
import {
  SIGNIN_HREF,
  SIGNIN_LABEL,
  SIGNUP_BENEFITS,
  SIGNUP_CTA_HREF,
  SIGNUP_CTA_LABEL,
  SIGNUP_FOOTNOTE,
  SIGNUP_SUBTITLE,
  SIGNUP_TITLE,
} from "@/lib/ui/signupBenefits";
import {
  SIGNUP_PROMPT_DELAY_MS,
  SIGNUP_PROMPT_STORAGE_KEY,
  hasScrolledPastThreshold,
  isTypingTarget,
  nextTrapIndex,
  parseDismissedAt,
  shouldShowSignupPrompt,
} from "@/lib/ui/signupPrompt";

// The benefit copy lives in lib/ui/signupBenefits.ts, shared with the /benefits page.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// In-memory "already dismissed this page session" flag: the only memory when
// localStorage is blocked, and a belt-and-braces guard otherwise.
let dismissedThisSession = false;

function readDismissedAt(): number | null {
  try {
    return parseDismissedAt(window.localStorage.getItem(SIGNUP_PROMPT_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeDismissedAt(now: number): void {
  try {
    window.localStorage.setItem(SIGNUP_PROMPT_STORAGE_KEY, String(now));
  } catch {
    // Storage blocked or full: the in-memory flag still covers this session.
  }
}

function isWebdriver(): boolean {
  try {
    return navigator.webdriver === true;
  } catch {
    return false;
  }
}

function typingInField(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  return isTypingTarget(el.tagName, el.isContentEditable);
}

export default function SignupPromptModal({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const eligible = useCallback(
    (): boolean =>
      shouldShowSignupPrompt({
        signedIn,
        webdriver: isWebdriver(),
        dismissedAt: readDismissedAt(),
        now: Date.now(),
        dismissedThisSession,
      }),
    [signedIn]
  );

  const dismiss = useCallback((restoreFocus: boolean) => {
    dismissedThisSession = true;
    writeDismissedAt(Date.now());
    setOpen(false);
    if (restoreFocus) {
      const target = returnFocusRef.current;
      // After the dialog unmounts, return focus to where the visitor was.
      window.setTimeout(() => {
        if (target && document.contains(target)) target.focus();
      }, 0);
    }
  }, []);

  // Trigger: 10 s timer or 60% scroll, whichever first; postponed while typing.
  useEffect(() => {
    if (signedIn || !eligible()) return;

    let timer: number | undefined;
    let retry: number | undefined;
    let done = false;

    const cleanupListeners = () => {
      window.clearTimeout(timer);
      window.clearTimeout(retry);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("focusout", onFocusOut);
    };

    const tryOpen = () => {
      if (done) return;
      if (!eligible()) {
        done = true;
        cleanupListeners();
        return;
      }
      if (typingInField()) return; // postponed: retried on focusout
      done = true;
      cleanupListeners();
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    };

    function onScroll() {
      const doc = document.documentElement;
      if (hasScrolledPastThreshold(window.scrollY, window.innerHeight, doc.scrollHeight)) {
        tryOpen();
      }
    }

    function onFocusOut() {
      // Let focus settle on its next element (or body) before re-checking.
      window.clearTimeout(retry);
      retry = window.setTimeout(tryOpen, 300);
    }

    timer = window.setTimeout(tryOpen, SIGNUP_PROMPT_DELAY_MS);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("focusout", onFocusOut);
    return () => {
      done = true;
      cleanupListeners();
    };
  }, [signedIn, eligible]);

  // While open: lock body scroll, move focus in, trap Tab, close on Escape.
  useEffect(() => {
    if (!open) return;

    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    panelRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss(true);
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = nextTrapIndex(current, items.length, e.shiftKey);
      if (next === null) {
        e.preventDefault();
        panel.focus();
        return;
      }
      // Only intercept at the ends (or when focus is on the panel/outside);
      // the browser handles Tab between inner items.
      const atEdge = e.shiftKey ? current <= 0 : current === items.length - 1 || current < 0;
      if (atEdge) {
        e.preventDefault();
        items[next]?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
    };
  }, [open, dismiss]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-brand-ink/60 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss(true);
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="signup-prompt-title"
        aria-describedby="signup-prompt-desc"
        tabIndex={-1}
        className="relative max-h-[85vh] w-full overflow-y-auto overscroll-contain rounded-t-brand-card bg-white px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-6 shadow-brand-card-hover focus:outline-none supports-[height:100dvh]:max-h-[85dvh] sm:max-w-md sm:rounded-brand-card sm:p-7"
      >
        <button
          type="button"
          aria-label="Close"
          onClick={() => dismiss(true)}
          className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-brand-pill text-brand-ink-muted transition hover:bg-brand-chip hover:text-brand-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
        >
          <XIcon className="h-5 w-5" />
        </button>

        <h2
          id="signup-prompt-title"
          className="pr-10 font-display text-2xl font-bold text-brand-ink"
        >
          {SIGNUP_TITLE}
        </h2>
        <p id="signup-prompt-desc" className="mt-1 text-sm text-brand-ink-muted">
          {SIGNUP_SUBTITLE}
        </p>

        <ul className="mt-5 space-y-4">
          {SIGNUP_BENEFITS.map(({ id, title, detail, icon }) => (
            <li key={id} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-brand-pill bg-brand-chip text-brand-chip-ink"
              >
                <BenefitIcon name={icon} className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-brand-ink">{title}</span>
                <span className="mt-0.5 block text-sm text-brand-ink-muted">{detail}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-col gap-2">
          <Link
            href={SIGNUP_CTA_HREF}
            onClick={() => dismiss(false)}
            className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2"
          >
            {SIGNUP_CTA_LABEL}
          </Link>
          <Link
            href={SIGNIN_HREF}
            onClick={() => dismiss(false)}
            className="flex min-h-[44px] items-center justify-center rounded-brand-control px-6 text-sm font-semibold text-brand-accent transition hover:text-brand-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
          >
            {SIGNIN_LABEL}
          </Link>
          <button
            type="button"
            onClick={() => dismiss(true)}
            className="flex min-h-[44px] items-center justify-center rounded-brand-control px-6 text-sm font-medium text-brand-ink-muted transition hover:text-brand-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
          >
            Maybe later
          </button>
        </div>

        <p className="mt-2 text-center text-xs text-brand-ink-subtle">
          {SIGNUP_FOOTNOTE}
        </p>
      </div>
    </div>
  );
}
