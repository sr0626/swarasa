"use client";

// Public "Report a problem / suggest an update" form — body matches
// `POST /reports` exactly (docs/API_CONTRACTS.md "Listing reports").
// Submits through a Server Action (app/restaurant/[brandSlug]/report/actions.ts)
// so a signed-in visitor's token is attached server-side and never handed
// to client JS; anonymous visitors work identically.
//
// Anti-abuse: the hidden `website` field is a honeypot — invisible and
// unfocusable for humans (aria-hidden, tabIndex -1, off-screen), so only a
// bot filling every input populates it. The backend answers those with the
// same success response and stores nothing, so the UI needs no special case.
import { useState } from "react";
import Link from "next/link";
import { submitReportAction } from "@/app/restaurant/[brandSlug]/report/actions";
import { REPORT_CATEGORIES } from "@/lib/constants/reportCategories";
import {
  createReportSchema,
  REPORT_DETAILS_MAX_LENGTH,
} from "@/lib/validation/listingReport";
import { ClipboardCheckIcon } from "@/components/ui/icons";
import { brandHref } from "@/lib/restaurant/urls";
import type { LocationSummary } from "@/types/location";
import type { ReportCategory } from "@/types/listingReport";

interface ReportProblemFormProps {
  brandId: number;
  brandName: string;
  /** Used for the "back to listing" link. */
  slug: string;
  locations: LocationSummary[];
  /** Location to pre-select (from `?location=` when reached from a location page); ignored
   * unless it is one of `locations`. */
  defaultLocationId?: number | null;
  /** Set (server-side, from the session cookie) when the visitor is signed
   * in: the email input is replaced by a read-only note and the backend
   * attributes the report to the verified token's email. */
  signedInEmail?: string | null;
}

export default function ReportProblemForm({
  brandId,
  brandName,
  slug,
  locations,
  defaultLocationId = null,
  signedInEmail = null,
}: ReportProblemFormProps) {
  const [category, setCategory] = useState<ReportCategory | "">("");
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [locationId, setLocationId] = useState<number | "">(
    locations.length === 1
      ? locations[0]!.id
      : locations.some((l) => l.id === defaultLocationId)
        ? (defaultLocationId as number)
        : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (category === "") {
      setError("Please choose what's wrong.");
      return;
    }

    const input = {
      brand_id: brandId,
      location_id: locationId === "" ? undefined : locationId,
      category,
      details,
      // Signed in: never send an email — the backend uses the token's.
      reporter_email: signedInEmail ? "" : email,
      website,
    };

    const parsed = createReportSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
      return;
    }

    setSubmitting(true);
    try {
      const outcome = await submitReportAction(input);
      if (outcome.ok) {
        setDone(true);
      } else {
        setError(outcome.error);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div
        role="status"
        className="rounded-brand-card border border-brand-border bg-white p-6 shadow-brand-card sm:p-8"
      >
        <div className="flex items-start gap-3">
          <ClipboardCheckIcon className="mt-0.5 h-8 w-8 shrink-0 text-brand-success" />
          <div>
            <p className="font-display text-lg font-bold text-brand-ink">
              Thanks — we got your report
            </p>
            <p className="mt-1 text-sm text-brand-ink-muted">
              Our team will review what you told us about <strong>{brandName}</strong> and
              update the listing if needed. Reports help keep Swarasa accurate for
              everyone.
            </p>
          </div>
        </div>
        <Link
          href={brandHref(slug)}
          className="mt-6 inline-flex min-h-[44px] items-center rounded-brand-pill bg-brand-ink px-5 text-sm font-semibold text-brand-bg transition hover:bg-brand-ink/90"
        >
          Back to {brandName}
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-brand-card border border-brand-border bg-white p-6 shadow-brand-card sm:p-8"
    >
      <fieldset>
        <legend className="font-display text-base font-semibold text-brand-ink">
          What&apos;s wrong?
        </legend>
        <div className="mt-3 flex flex-col gap-2">
          {REPORT_CATEGORIES.map((option) => {
            const selected = category === option.value;
            return (
              <label
                key={option.value}
                className={
                  selected
                    ? "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-brand-control border-2 border-brand-accent bg-brand-bg px-4 py-2.5"
                    : "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-brand-control border border-brand-border bg-white px-4 py-2.5 transition hover:border-brand-ink-subtle"
                }
              >
                <input
                  type="radio"
                  name="category"
                  value={option.value}
                  checked={selected}
                  onChange={() => setCategory(option.value)}
                  className="h-4 w-4 shrink-0 accent-brand-accent"
                />
                <span className="text-sm font-medium text-brand-ink">{option.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {locations.length > 1 && (
        <div className="mt-6">
          <label htmlFor="report_location" className="text-sm font-semibold text-brand-ink">
            Which location? <span className="font-normal text-brand-ink-subtle">(optional)</span>
          </label>
          <select
            id="report_location"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value === "" ? "" : Number(e.target.value))}
            className="mt-2 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink focus:border-brand-accent focus:outline-none"
          >
            <option value="">Not sure / all locations</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.address_line1}, {loc.city}, {loc.state}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-6">
        <label htmlFor="report_details" className="text-sm font-semibold text-brand-ink">
          Tell us more
        </label>
        <textarea
          id="report_details"
          required
          rows={5}
          maxLength={REPORT_DETAILS_MAX_LENGTH}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="e.g. They moved to 123 Main St, or they're closed on Mondays now."
          className="mt-2 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none"
        />
        <p className="mt-1 text-right text-xs text-brand-ink-subtle">
          {details.length}/{REPORT_DETAILS_MAX_LENGTH}
        </p>
      </div>

      {signedInEmail ? (
        <p className="mt-4 text-sm text-brand-ink-muted" data-testid="report-signed-in-note">
          Reporting as <strong className="break-all text-brand-ink">{signedInEmail}</strong>.
          Only used if we need to ask a follow-up question. Never shown publicly.
        </p>
      ) : (
        <div className="mt-4">
          <label htmlFor="report_email" className="text-sm font-semibold text-brand-ink">
            Your email <span className="font-normal text-brand-ink-subtle">(optional)</span>
          </label>
          <input
            id="report_email"
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-2 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none"
          />
          <p className="mt-1 text-xs text-brand-ink-subtle">
            Only used if we need to ask a follow-up question. Never shown publicly.
          </p>
        </div>
      )}

      {/* Honeypot — see header comment. Not a real field: hidden from
          sighted users, screen readers, tab order, and autofill. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="report_website">Leave this field empty</label>
        <input
          id="report_website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-6 flex min-h-[44px] w-full items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {submitting ? "Sending..." : "Send report"}
      </button>
    </form>
  );
}
