// Contact admin — owners and managers write to the platform admins from
// inside the console (POST /contact-admin; admins read it in /admin/messages).
// Replaces "email us" for signed-in business users: the message arrives with
// their verified email, role and, optionally, the related location attached.
// The public /contact page (mailto) is unchanged for everyone else.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/guards";
import { loadConsoleIdentity } from "@/lib/auth/consoleIdentity";
import { loadContactAdminLocationOptions } from "@/lib/contactAdminLocations";
import ContactAdminForm from "@/components/portal/ContactAdminForm";
import ManagerShell from "@/components/portal/ManagerShell";
import OwnerShell from "@/components/portal/OwnerShell";

export const metadata: Metadata = {
  title: "Contact admin",
};

function Intro() {
  return (
    <div className="mb-5">
      <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
        Contact admin
      </h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        Questions about a listing, a claim, or the platform? Send us a message and we&apos;ll
        reply to the email on your account. We aim to respond within 2 business days.
      </p>
    </div>
  );
}

export default async function ContactAdminPage() {
  const session = await requireSession(["owner", "manager", "admin", "registered_user"]);
  if (session.role !== "owner" && session.role !== "manager") {
    redirect("/account");
  }

  const [me, locations] = await Promise.all([
    loadConsoleIdentity(session),
    loadContactAdminLocationOptions(session.role, session.accessToken),
  ]);

  if (session.role === "manager") {
    return (
      <ManagerShell me={me}>
        <Intro />
        <ContactAdminForm locations={locations} />
      </ManagerShell>
    );
  }

  return (
    <OwnerShell me={me}>
      <Intro />
      <ContactAdminForm locations={locations} />
    </OwnerShell>
  );
}
