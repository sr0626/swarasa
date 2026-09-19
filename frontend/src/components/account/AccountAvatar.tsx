// Initials avatar shared by every role's account header. `size` picks the
// large hero size (diner/owner summary) or the compact size (manager/admin
// header strips).
import { initialsFor } from "@/components/account/accountShared";
import type { AuthMe } from "@/types/auth";

const SIZE_CLASS = {
  lg: "h-20 w-20 border-4 text-2xl",
  sm: "h-14 w-14 border-2 text-lg",
} as const;

export default function AccountAvatar({
  me,
  size = "lg",
  className = "",
}: {
  me: AuthMe;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full border-white bg-brand-chip font-display font-bold text-brand-chip-ink shadow-brand-control ${SIZE_CLASS[size]} ${className}`}
    >
      {initialsFor(me.owner_account?.full_name ?? null, me.email)}
    </div>
  );
}
