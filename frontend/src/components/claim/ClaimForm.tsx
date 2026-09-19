"use client";

// Claim submission form — body shape matches `POST /claim` exactly
// (docs/API_CONTRACTS.md "Claim flow (`/claim`)"), validated client-side
// with the existing `createClaimSchema` (frontend/src/lib/validation/claim.ts)
// before ever calling the server action.
//
// FLAGGED GAP — document_upload proof method (see PR description): the
// contract's `supporting_document_url` is described as "an S3 key from a
// presigned upload," but unlike `/locations/{id}/photos/upload-url`,
// `/claim` has no matching `POST /claim/.../upload-url` endpoint anywhere
// in docs/API_CONTRACTS.md or backend/app/routers/claim.py — there is
// nothing to request a presigned URL from for this specific flow. Rather
// than fabricate an endpoint, this proof method is implemented as a plain
// URL field (a link to an already-hosted document, e.g. a shared Drive/
// Dropbox link) with an explicit note to the claimant. Once a presigned
// upload-url endpoint exists for claim documents, swap this field for a
// real file picker following the exact two-step pattern
// `frontend/src/lib/api/locations.ts`'s photo upload already uses
// (getLocationPhotoUploadUrl -> PUT to S3 -> createLocationPhoto).
import { useState } from "react";
import Link from "next/link";
import { submitClaimAction } from "@/app/claim/actions";
import { createClaimSchema } from "@/lib/validation/claim";
import { formatPhone } from "@/lib/formatPhone";
import { UploadIcon, PhoneIcon, ClipboardCheckIcon } from "@/components/ui/icons";
import ClaimStatusBadge from "@/components/claim/ClaimStatusBadge";
import type { ClaimProofMethod, ClaimResponse } from "@/types/claim";
import type { LocationSummary } from "@/types/location";

interface ClaimFormProps {
  brandId: number;
  brandName: string;
  locations: LocationSummary[];
}

const PROOF_METHODS: Array<{
  value: ClaimProofMethod;
  label: string;
  description: string;
}> = [
  {
    value: "google_business_profile",
    label: "Google Business Profile",
    description:
      "Fastest path — link your Google Business Profile listing and our reviewer treats a matching name/address as pre-verified.",
  },
  {
    value: "phone_verification",
    label: "Phone verification",
    description:
      "We'll place an outbound call to the phone number already listed for this location to confirm you're reachable there.",
  },
  {
    value: "document_upload",
    label: "Document upload",
    description:
      "Fallback option — provide a business license or utility bill for manual admin review.",
  },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ClaimForm({ brandId, brandName, locations }: ClaimFormProps) {
  const [proofMethod, setProofMethod] = useState<ClaimProofMethod>(
    "google_business_profile"
  );
  const [gbpUrl, setGbpUrl] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [locationId, setLocationId] = useState<number | "">(
    locations.length === 1 ? locations[0]!.id : ""
  );
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ClaimResponse | null>(null);

  const needsLocationPicker = proofMethod === "phone_verification" && locations.length > 1;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFieldError(null);
    setSubmitError(null);

    // location_id is only meaningful for phone_verification (identifies
    // which location's public phone number to call) — omitted for the
    // other two proof methods per docs/API_CONTRACTS.md "POST /claim".
    const input = {
      brand_id: brandId,
      location_id:
        proofMethod === "phone_verification" && locationId !== ""
          ? locationId
          : undefined,
      proof_method: proofMethod,
      google_business_profile_url:
        proofMethod === "google_business_profile" ? gbpUrl.trim() : null,
      supporting_document_url:
        proofMethod === "document_upload" ? documentUrl.trim() : null,
    };

    const parsed = createClaimSchema.safeParse(input);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
      return;
    }

    setSubmitting(true);
    try {
      const outcome = await submitClaimAction(input);
      if (outcome.ok) {
        setResult(outcome.claim);
      } else {
        setSubmitError(outcome.error);
      }
    } catch {
      // The Server Action itself rejected (network drop, deploy skew, a
      // framework-level 5xx) -- previously unhandled, so the button just
      // reset and nothing at all was shown.
      setSubmitError("Something went wrong submitting your claim. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="rounded-brand-card border border-brand-border bg-white p-6 shadow-brand-card sm:p-8">
        <div className="flex items-start gap-3">
          <ClipboardCheckIcon className="mt-0.5 h-8 w-8 shrink-0 text-brand-success" />
          <div>
            <p className="font-display text-lg font-bold text-brand-ink">
              Claim submitted — pending review
            </p>
            <p className="mt-1 text-sm text-brand-ink-muted">
              We&apos;ve received your claim for <strong>{brandName}</strong>. An admin
              will review it within 2 business days; this is not an automatic
              approval, even if you provided a Google Business Profile match.
            </p>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-3 rounded-brand-control bg-brand-bg p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-brand-ink-subtle">Status</dt>
            <dd className="mt-1">
              <ClaimStatusBadge status={result.status} />
            </dd>
          </div>
          <div>
            <dt className="text-brand-ink-subtle">Claim ID</dt>
            <dd className="mt-1 font-medium text-brand-ink">#{result.claim_id}</dd>
          </div>
          <div>
            <dt className="text-brand-ink-subtle">Submitted</dt>
            <dd className="mt-1 font-medium text-brand-ink">
              {formatDate(result.submitted_at)}
            </dd>
          </div>
          <div>
            <dt className="text-brand-ink-subtle">Review due by</dt>
            <dd className="mt-1 font-medium text-brand-ink">
              {formatDate(result.sla_due_at)}
            </dd>
          </div>
        </dl>

        <Link
          href="/"
          className="mt-6 inline-flex min-h-[44px] items-center rounded-brand-pill bg-brand-ink px-5 text-sm font-semibold text-brand-bg transition hover:bg-brand-ink/90"
        >
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-brand-card border border-brand-border bg-white p-6 shadow-brand-card sm:p-8"
    >
      <fieldset>
        <legend className="font-display text-base font-semibold text-brand-ink">
          How do you want to verify your ownership?
        </legend>
        <div className="mt-3 flex flex-col gap-3">
          {PROOF_METHODS.map((method) => {
            const selected = proofMethod === method.value;
            return (
              <label
                key={method.value}
                className={
                  selected
                    ? "flex cursor-pointer items-start gap-3 rounded-brand-control border-2 border-brand-accent bg-brand-bg p-4"
                    : "flex cursor-pointer items-start gap-3 rounded-brand-control border border-brand-border bg-white p-4 transition hover:border-brand-ink-subtle"
                }
              >
                <input
                  type="radio"
                  name="proof_method"
                  value={method.value}
                  checked={selected}
                  onChange={() => setProofMethod(method.value)}
                  className="mt-1 h-4 w-4 shrink-0 accent-brand-accent"
                />
                <span>
                  <span className="block text-sm font-semibold text-brand-ink">
                    {method.label}
                  </span>
                  <span className="mt-0.5 block text-sm text-brand-ink-muted">
                    {method.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-6">
        {proofMethod === "google_business_profile" && (
          <div>
            <label htmlFor="gbp_url" className="text-sm font-semibold text-brand-ink">
              Google Business Profile URL
            </label>
            <input
              id="gbp_url"
              type="url"
              required
              value={gbpUrl}
              onChange={(e) => setGbpUrl(e.target.value)}
              placeholder="https://business.google.com/..."
              className="mt-2 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none"
            />
          </div>
        )}

        {proofMethod === "phone_verification" && (
          <div className="rounded-brand-control border border-dashed border-brand-border bg-brand-bg p-4">
            <div className="flex items-start gap-3">
              <PhoneIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand-ink-subtle" />
              <p className="text-sm text-brand-ink-muted">
                We&apos;ll call the phone number already listed on this restaurant&apos;s
                public page — never a number you enter here — to confirm you can be
                reached at it. No further action is needed on this form for this
                option.
              </p>
            </div>
            {needsLocationPicker && (
              <div className="mt-4">
                <label htmlFor="location_id" className="text-sm font-semibold text-brand-ink">
                  Which location&apos;s number should we call?
                </label>
                <select
                  id="location_id"
                  required
                  value={locationId}
                  onChange={(e) => setLocationId(Number(e.target.value))}
                  className="mt-2 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink focus:border-brand-accent focus:outline-none"
                >
                  <option value="" disabled>
                    Select a location
                  </option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.address_line1}, {loc.city}, {loc.state}
                      {loc.phone ? ` — ${formatPhone(loc.phone)}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {proofMethod === "document_upload" && (
          <div>
            <label htmlFor="document_url" className="text-sm font-semibold text-brand-ink">
              Link to your supporting document
            </label>
            <div className="mt-2 flex items-start gap-2 rounded-brand-control border border-brand-border bg-white px-3 py-2.5">
              <UploadIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink-subtle" />
              <input
                id="document_url"
                type="url"
                required
                value={documentUrl}
                onChange={(e) => setDocumentUrl(e.target.value)}
                placeholder="https://drive.google.com/... or a Dropbox share link"
                className="w-full min-w-0 border-0 bg-transparent text-sm text-brand-ink placeholder:text-brand-placeholder focus:outline-none"
              />
            </div>
            <p className="mt-2 text-xs text-brand-ink-subtle">
              A business license or utility bill showing this restaurant&apos;s name
              and address. Paste a shareable link for now — direct file upload will
              be added once a presigned-upload endpoint exists for this flow.
            </p>
          </div>
        )}
      </div>

      {(fieldError || submitError) && (
        <p className="mt-4 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
          {fieldError ?? submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-6 flex min-h-[44px] w-full items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {submitting ? "Submitting..." : "Submit claim"}
      </button>
    </form>
  );
}
