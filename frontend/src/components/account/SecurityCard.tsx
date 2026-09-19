// "Security" card linking to the change-password page — shared by every
// role's /account layout (extracted from the previous single-layout page).
import Link from "next/link";
import { cardClass, outlinePillLinkClass } from "@/components/account/accountShared";

export default function SecurityCard() {
  return (
    <section
      aria-labelledby="security-heading"
      className={`${cardClass} flex flex-col items-start gap-3`}
    >
      <div>
        <h2 id="security-heading" className="font-display text-xl font-bold text-brand-ink">
          Security
        </h2>
        <p className="mt-1 text-sm text-brand-ink-muted">Change your account password.</p>
      </div>
      <Link href="/account/security" className={outlinePillLinkClass}>
        Change password
      </Link>
    </section>
  );
}
