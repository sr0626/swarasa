"use client";

// Restaurant's answer to one catering request: a dollar quote + note, or a
// decline. One response per request, editable until it expires — the form
// pre-fills the current response and the button says "Update". After a
// successful quote the (now revealed) diner contact is shown by refreshing
// the server-rendered page.
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import LocalDateTime from "@/components/ui/LocalDateTime";
import { respondToCateringAction } from "@/lib/actions/catering";
import { centsToInput, parseQuoteAmount, QUOTE_NOTE_MAX } from "@/lib/catering/quoteForm";
import { formatCents } from "@/lib/catering/summary";
import type { InboxDetail } from "@/types/catering";

const inputClass =
  "mt-1.5 min-h-[44px] w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-base text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none sm:text-sm";
const labelClass = "text-sm font-semibold text-brand-ink";

export default function CateringResponseForm({ detail }: { detail: InboxDetail }) {
  const router = useRouter();
  const [amount, setAmount] = useState(
    detail.quote_amount_cents !== null ? centsToInput(detail.quote_amount_cents) : ""
  );
  const [note, setNote] = useState(detail.quote_note ?? "");
  const [busy, setBusy] = useState<"quote" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  if (!detail.can_respond) {
    return (
      <section className="rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card sm:p-5">
        <h2 className="font-display text-lg font-bold text-brand-ink">Your response</h2>
        {detail.status === "quoted" && detail.quote_amount_cents !== null ? (
          <p className="mt-2 text-sm text-brand-ink-muted">
            You quoted <span className="font-bold text-brand-ink">{formatCents(detail.quote_amount_cents)}</span>.
          </p>
        ) : (
          <p className="mt-2 text-sm text-brand-ink-muted">
            {detail.status === "declined" ? "You declined this request. " : ""}
            This request is no longer open
            {detail.request_status === "cancelled" ? " (the diner cancelled it)" : ""}, so it can&apos;t be
            answered.
          </p>
        )}
      </section>
    );
  }

  async function send(decision: "quote" | "decline", e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setSaved(null);
    if (decision === "quote") {
      const parsed = parseQuoteAmount(amount);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
    }
    setBusy(decision);
    const result = await respondToCateringAction(detail.recipient_id, { decision, amount, note });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(decision === "quote" ? "Quote sent to the diner." : "You declined this request.");
    router.refresh();
  }

  const answered = detail.status === "quoted" || detail.status === "declined";

  return (
    <form
      onSubmit={(e) => send("quote", e)}
      noValidate
      className="rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card sm:p-5"
    >
      <h2 className="font-display text-lg font-bold text-brand-ink">Your response</h2>
      {answered && (
        <p className="mt-1 text-sm text-brand-ink-muted">
          {detail.status === "quoted" && detail.quote_amount_cents !== null
            ? `You quoted ${formatCents(detail.quote_amount_cents)}`
            : "You declined"}
          {detail.quoted_at && (
            <>
              {" "}
              on <LocalDateTime value={detail.quoted_at} variant="date" />
            </>
          )}
          . You can change your answer until the request expires.
        </p>
      )}

      <div className="mt-3">
        <label htmlFor="quote-amount" className={labelClass}>
          Total quote (USD)
        </label>
        <div className="relative">
          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-[1.35rem] text-sm text-brand-ink-subtle">
            $
          </span>
          <input
            id="quote-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="450.00"
            aria-describedby="quote-amount-hint"
            className={`${inputClass} pl-7`}
          />
        </div>
        <p id="quote-amount-hint" className="mt-1 text-xs text-brand-ink-subtle">
          One price for the whole order, up to $1,000,000.
        </p>
      </div>

      <div className="mt-3">
        <label htmlFor="quote-note" className={labelClass}>
          Note to the diner <span className="font-normal text-brand-ink-subtle">(optional)</span>
        </label>
        <textarea
          id="quote-note"
          rows={4}
          maxLength={QUOTE_NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What's included, delivery fee, deposit, availability..."
          className={inputClass}
        />
        <p className="mt-1 text-right text-xs text-brand-ink-subtle">
          {note.length} / {QUOTE_NOTE_MAX}
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="mt-3 rounded-brand-control bg-brand-success-bg px-3 py-2.5 text-sm text-brand-success">
          {saved}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <button
          type="submit"
          disabled={busy !== null}
          className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "quote" ? "Sending..." : detail.status === "quoted" ? "Update quote" : "Send quote"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void send("decline")}
          className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border px-6 text-sm font-semibold text-brand-ink-muted transition hover:bg-brand-chip disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "decline" ? "Declining..." : "Decline request"}
        </button>
      </div>
    </form>
  );
}
