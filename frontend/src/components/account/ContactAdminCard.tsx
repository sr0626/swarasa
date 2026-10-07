// "Need help?" card on /account for owners and managers — links to the
// Contact admin form (/portal/contact-admin). Server Component.
import Link from "next/link";
import { CONTACT_ADMIN_HREF } from "@/components/console/navItems";
import { MailIcon } from "@/components/ui/icons";

export default function ContactAdminCard() {
  return (
    <section
      aria-labelledby="contact-admin-heading"
      className="flex flex-col gap-4 rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:flex-row sm:items-center sm:justify-between sm:p-6"
    >
      <div>
        <h2
          id="contact-admin-heading"
          className="flex items-center gap-2 font-display text-xl font-bold text-brand-ink"
        >
          <MailIcon className="h-5 w-5 text-brand-ink-subtle" />
          Need help?
        </h2>
        <p className="mt-1 text-sm text-brand-ink-muted">
          Questions about a listing, a claim, or the platform? Message the Swarasa admins.
        </p>
      </div>
      <Link
        href={CONTACT_ADMIN_HREF}
        className="flex min-h-[44px] shrink-0 items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover"
      >
        Contact admin
      </Link>
    </section>
  );
}
