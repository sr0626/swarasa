"use client";

// "Add owner" form on /admin/owners: pre-creates the owner account for an
// EXISTING Cognito owner-group user, by email (POST /admin/owners). It does
// not invite anyone or send email -- the person must already have an owner
// sign-in. After success the server-rendered list is refreshed.
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { addOwnerAction } from "@/app/admin/owners/actions";
import { looksLikeEmail } from "@/lib/adminOwnerAssignment";

export default function AddOwnerForm() {
  const uid = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setAdded(null);
    if (!looksLikeEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setPending(true);
    try {
      const result = await addOwnerAction(email);
      if (result.ok) {
        setAdded(result.owner.email);
        setEmail("");
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const inputId = `${uid}-email`;
  const hintId = `${uid}-hint`;

  return (
    <div className="mt-4">
      {added && (
        <p
          role="status"
          className="mb-3 rounded-brand-control bg-brand-success-bg px-3 py-2.5 text-sm text-brand-success"
        >
          Owner account created for {added}. You can now assign listings to them from the Listings
          page.
        </p>
      )}
      {!open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setAdded(null);
          }}
          className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border bg-white px-4 text-sm font-semibold text-brand-ink transition hover:bg-brand-chip"
        >
          Add owner
        </button>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !pending) {
              setOpen(false);
              setError(null);
            }
          }}
          aria-label="Add owner"
          className="rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card"
        >
          <label htmlFor={inputId} className="block text-sm font-semibold text-brand-ink">
            Owner email
          </label>
          <p id={hintId} className="mt-1 text-xs text-brand-ink-muted">
            Creates the owner account for someone who already has an owner sign-in. No invitation is
            sent.
          </p>
          <input
            id={inputId}
            type="email"
            value={email}
            maxLength={255}
            autoComplete="off"
            aria-describedby={hintId}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="owner@example.com"
            className="mt-2 min-h-[44px] w-full rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none"
          />
          {error && (
            <p
              role="alert"
              className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
            >
              {error}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={pending || !email.trim()}
              className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Adding..." : "Add owner"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border bg-white px-4 text-sm font-semibold text-brand-ink transition hover:bg-brand-chip disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
