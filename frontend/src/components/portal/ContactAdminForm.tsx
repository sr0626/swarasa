"use client";

// "Contact admin" form for signed-in owners and managers — POST
// /contact-admin via contactAdminAction. Subject + message, plus an optional
// dropdown of the sender's own locations so the admin sees which listing it
// is about. The backend re-validates everything (lengths, location access,
// 5-per-hour rate limit); this form only mirrors the bounds for fast feedback.
import Link from "next/link";
import { useState } from "react";
import { contactAdminAction } from "@/app/portal/contact-admin/actions";
import {
  BODY_MAX_LENGTH,
  BODY_MIN_LENGTH,
  SUBJECT_MAX_LENGTH,
  SUBJECT_MIN_LENGTH,
  type ContactAdminLocationOption,
} from "@/types/adminMessage";

const inputClass =
  "mt-1.5 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none";
const labelClass = "text-sm font-semibold text-brand-ink";

export default function ContactAdminForm({
  locations,
}: {
  locations: ContactAdminLocationOption[];
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [locationId, setLocationId] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subjectOk = subject.trim().length >= SUBJECT_MIN_LENGTH;
  const bodyOk = body.trim().length >= BODY_MIN_LENGTH;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const result = await contactAdminAction({
        subject,
        body,
        relatedLocationId: locationId === "" ? null : Number(locationId),
      });
      if (result.ok) {
        setSent(true);
      } else {
        setError(result.error);
      }
    } finally {
      setSending(false);
    }
  }

  function reset() {
    setSubject("");
    setBody("");
    setLocationId("");
    setError(null);
    setSent(false);
  }

  if (sent) {
    return (
      <div
        role="status"
        className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
      >
        <h2 className="font-display text-xl font-bold text-brand-ink">Message sent</h2>
        <p className="mt-2 text-sm text-brand-ink-muted">
          Thanks &mdash; an admin will review it and reply to the email on your account.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={reset}
            className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover"
          >
            Send another message
          </button>
          <Link
            href="/account"
            className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border px-6 text-sm font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
          >
            Back to my account
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <div>
        <label htmlFor="contact_subject" className={labelClass}>
          Subject
        </label>
        <input
          id="contact_subject"
          type="text"
          required
          minLength={SUBJECT_MIN_LENGTH}
          maxLength={SUBJECT_MAX_LENGTH}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className={inputClass}
        />
      </div>

      {locations.length > 0 && (
        <div>
          <label htmlFor="contact_location" className={labelClass}>
            Related location <span className="font-normal text-brand-ink-subtle">(optional)</span>
          </label>
          <select
            id="contact_location"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className={`${inputClass} min-h-[44px]`}
          >
            <option value="">Not about a specific location</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="contact_body" className={labelClass}>
          Message
        </label>
        <textarea
          id="contact_body"
          required
          rows={7}
          minLength={BODY_MIN_LENGTH}
          maxLength={BODY_MAX_LENGTH}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className={inputClass}
        />
        <p className="mt-1 text-right text-xs text-brand-ink-subtle">
          {body.length} / {BODY_MAX_LENGTH}
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={sending || !subjectOk || !bodyOk}
        className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:self-start"
      >
        {sending ? "Sending..." : "Send message"}
      </button>
    </form>
  );
}
