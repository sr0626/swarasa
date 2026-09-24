"use client";

// Shared hide/show controls for the owner editor (menu items, menu groups,
// the whole menu, and deals). Hiding NEVER deletes anything: a hidden thing
// stays in the editor, clearly marked "Hidden", with a one-click Show. All
// toggles are instant (no confirmation) — the calling manager updates its
// state optimistically and reverts on failure.
//
// Accessibility: every toggle is a real <button> with `aria-pressed` (pressed
// = currently hidden) and a stable, descriptive accessible name; touch targets
// are at least 44px tall.
import { EyeIcon, EyeOffIcon } from "@/components/ui/icons";

/** Small dark pill that says a thing is hidden from diners. */
export function HiddenChip({ label = "Hidden" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-brand-pill bg-brand-ink px-2 py-0.5 text-xs font-semibold text-brand-bg">
      <EyeOffIcon className="h-3 w-3" />
      {label}
    </span>
  );
}

/**
 * One-click Hide / Show for a single thing (a dish, a group, a deal).
 * `name` builds the accessible name: "Hide {name} from diners" (pressed
 * when it IS hidden, so a screen reader announces the current state).
 */
export function VisibilityToggleButton({
  hidden,
  name,
  onToggle,
  disabled = false,
  busy = false,
}: {
  hidden: boolean;
  name: string;
  onToggle: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={hidden}
      aria-label={`Hide ${name} from diners`}
      title={hidden ? `Show ${name} to diners again` : `Hide ${name} from diners`}
      disabled={disabled || busy}
      onClick={onToggle}
      className={
        hidden
          ? "flex min-h-[44px] items-center gap-1.5 rounded-brand-control bg-brand-ink px-3 text-xs font-semibold text-brand-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          : "flex min-h-[44px] items-center gap-1.5 rounded-brand-control border border-brand-border bg-white px-3 text-xs font-semibold text-brand-ink transition hover:border-brand-ink-subtle disabled:cursor-not-allowed disabled:opacity-60"
      }
    >
      {hidden ? <EyeIcon className="h-3.5 w-3.5" /> : <EyeOffIcon className="h-3.5 w-3.5" />}
      {hidden ? "Show" : "Hide"}
    </button>
  );
}

/**
 * Section-level switch bar ("Hide entire menu" / "Hide all deals"): says in
 * plain words whether diners can currently see the section, and offers the
 * one-click switch. When hidden it is visually loud so an owner never
 * wonders why nothing shows publicly.
 */
export function SectionVisibilityBar({
  hidden,
  visibleText,
  hiddenText,
  hideLabel,
  showLabel,
  onToggle,
  busy = false,
}: {
  hidden: boolean;
  /** Status line while visible, e.g. "Your menu is visible to diners." */
  visibleText: string;
  /** Status line while hidden. */
  hiddenText: string;
  /** Button text to hide, e.g. "Hide entire menu". */
  hideLabel: string;
  /** Button text to show again, e.g. "Show menu". */
  showLabel: string;
  onToggle: () => void;
  busy?: boolean;
}) {
  return (
    <div
      className={
        hidden
          ? "mt-4 flex flex-col gap-3 rounded-brand-control border border-brand-ink bg-brand-chip p-4 sm:flex-row sm:items-center sm:justify-between"
          : "mt-4 flex flex-col gap-3 rounded-brand-control border border-brand-border bg-brand-bg p-4 sm:flex-row sm:items-center sm:justify-between"
      }
    >
      <p
        role="status"
        aria-live="polite"
        className="flex min-w-0 items-start gap-2 text-sm text-brand-ink"
      >
        {hidden ? (
          <EyeOffIcon className="mt-0.5 h-4 w-4 shrink-0" />
        ) : (
          <EyeIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink-subtle" />
        )}
        <span className={hidden ? "font-semibold" : ""}>{hidden ? hiddenText : visibleText}</span>
      </p>
      <button
        type="button"
        aria-pressed={hidden}
        aria-label={hideLabel}
        title={hidden ? showLabel : hideLabel}
        disabled={busy}
        onClick={onToggle}
        className={
          hidden
            ? "flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            : "flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-brand-control border border-brand-border bg-white px-5 text-sm font-semibold text-brand-ink transition hover:border-brand-ink-subtle disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {hidden ? <EyeIcon className="h-4 w-4" /> : <EyeOffIcon className="h-4 w-4" />}
        {hidden ? showLabel : hideLabel}
      </button>
    </div>
  );
}
