// The small count badge on a console menu item / group. Decorative to assistive
// tech (`aria-hidden`): the owning link/button carries the full accessible name
// ("Claims, 3 pending, 1 overdue"). The number is real text, so the badge never
// relies on colour alone; `urgent` (overdue claims, or a group containing them)
// only strengthens the style.
import type { NavBadge } from "@/lib/ui/queueBadges";

export default function NavBadgePill({ badge, className = "" }: { badge: NavBadge; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-bold leading-none tabular-nums text-white ring-1 ring-white/70 ${
        badge.urgent ? "bg-brand-accent" : "bg-brand-chip-ink"
      } ${className}`}
    >
      {badge.text}
    </span>
  );
}
