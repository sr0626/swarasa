"use client";

// "Request catering quote" flow for signed-in registered users, 3 steps:
//   1 Details  — event date, headcount, delivery/pickup, items repeater, notes
//   2 Restaurants — ONLY eligible (subscribed + opted-in) restaurants, search
//                   by name/city, checkbox selection capped at the API's max
//   3 Review   — summary + submit (POST /catering/requests via a Server Action)
// Pure logic (validation, selection cap, labels) lives in lib/catering/*.ts and
// is unit-tested; this file is only state + markup. The server re-validates
// everything and answers a generic "not available" if any restaurant stopped
// being eligible meanwhile.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  searchCateringRestaurantsAction,
  submitCateringRequestAction,
} from "@/lib/actions/catering";
import {
  buildRequestPayload,
  canAddItem,
  canRemoveItem,
  emptyDraft,
  emptyItem,
  isValid,
  validateDraft,
  type DraftErrors,
  type ItemDraft,
  type RequestDraft,
} from "@/lib/catering/requestForm";
import {
  canContinue,
  isRowDisabled,
  selectionCounter,
  toggleSelection,
} from "@/lib/catering/selection";
import {
  fulfillmentLabel,
  formatEventDate,
  itemLine,
  SIZE_OPTIONS,
} from "@/lib/catering/summary";
import {
  CATERING_ITEM_NAME_MAX,
  CATERING_ITEM_NOTE_MAX,
  CATERING_ITEM_QUANTITY_MAX,
  CATERING_MAX_HEADCOUNT,
  CATERING_NOTES_MAX,
  type CateringConfig,
  type EligibleRestaurant,
} from "@/types/catering";

type Step = 1 | 2 | 3;

const STEPS: ReadonlyArray<{ n: Step; label: string }> = [
  { n: 1, label: "Details" },
  { n: 2, label: "Restaurants" },
  { n: 3, label: "Review" },
];

const inputBase =
  "mt-1.5 min-h-[44px] w-full rounded-brand-control border bg-white px-3 py-2.5 text-base text-brand-ink placeholder:text-brand-placeholder focus:outline-none sm:text-sm";
const labelClass = "text-sm font-semibold text-brand-ink";
const primaryBtn =
  "flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60";
const secondaryBtn =
  "flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border px-6 text-sm font-semibold text-brand-ink-muted transition hover:bg-brand-chip disabled:cursor-not-allowed disabled:opacity-60";

function inputClass(hasError: boolean): string {
  return `${inputBase} ${
    hasError ? "border-brand-closed focus:border-brand-closed" : "border-brand-border focus:border-brand-accent"
  }`;
}

function localTodayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-brand-closed">
      {message}
    </p>
  );
}

function Stepper({ step }: { step: Step }) {
  return (
    <ol aria-label="Progress" className="mb-6 flex items-center gap-2 text-sm">
      {STEPS.map((s) => (
        <li
          key={s.n}
          aria-current={s.n === step ? "step" : undefined}
          className={
            "flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-brand-control border px-2 text-center font-semibold " +
            (s.n === step
              ? "border-brand-ink bg-brand-ink text-brand-bg"
              : s.n < step
                ? "border-brand-border bg-brand-chip text-brand-ink"
                : "border-brand-border bg-white text-brand-ink-subtle")
          }
        >
          <span aria-hidden="true">{s.n}</span>
          <span>{s.label}</span>
          <span className="sr-only">
            {s.n < step ? " (done)" : s.n === step ? " (current step)" : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function CateringRequestWizard({
  config,
  initialRestaurant,
}: {
  config: CateringConfig;
  /** Pre-selected from a location page ("Get catering quotes" link). */
  initialRestaurant: EligibleRestaurant | null;
}) {
  const max = config.max_restaurants;
  const keyCounter = useRef(1);
  const nextKey = () => `item-${keyCounter.current++}`;

  const [step, setStep] = useState<Step>(1);
  const [draft, setDraft] = useState<RequestDraft>(() => emptyDraft("item-0"));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [today, setToday] = useState("");
  const [selected, setSelected] = useState<EligibleRestaurant[]>(
    initialRestaurant ? [initialRestaurant] : []
  );
  const [capNotice, setCapNotice] = useState(false);

  const [city, setCity] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<EligibleRestaurant[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => setToday(localTodayIso()), []);

  const selectedIds = selected.map((r) => r.location_id);

  const runSearch = useCallback(
    async (nextPage: number, nextCity: string, nextQ: string) => {
      setLoading(true);
      setSearchError(null);
      const result = await searchCateringRestaurantsAction({
        city: nextCity,
        q: nextQ,
        page: nextPage,
      });
      setLoading(false);
      if (result.ok) {
        setResults(result.data.results);
        setTotal(result.data.total);
        setPage(nextPage);
      } else {
        setSearchError(result.error);
      }
    },
    []
  );

  // Load the first page when the restaurants step opens.
  useEffect(() => {
    if (step === 2) void runSearch(1, city, q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function setField<K extends keyof RequestDraft>(key: K, value: RequestDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setItem(index: number, patch: Partial<ItemDraft>) {
    setDraft((d) => ({
      ...d,
      items: d.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  function addItem() {
    setDraft((d) => (canAddItem(d.items.length) ? { ...d, items: [...d.items, emptyItem(nextKey())] } : d));
  }

  function removeItem(index: number) {
    setDraft((d) =>
      canRemoveItem(d.items.length) ? { ...d, items: d.items.filter((_, i) => i !== index) } : d
    );
  }

  function goToRestaurants(e: FormEvent) {
    e.preventDefault();
    const found = validateDraft(draft, today || localTodayIso());
    setErrors(found);
    if (!isValid(found)) return;
    setStep(2);
  }

  function toggleRestaurant(restaurant: EligibleRestaurant) {
    const result = toggleSelection(selectedIds, restaurant.location_id, max);
    setCapNotice(result.atCap);
    if (result.atCap) return;
    setSelected((prev) =>
      result.selected.includes(restaurant.location_id)
        ? [...prev, restaurant]
        : prev.filter((r) => r.location_id !== restaurant.location_id)
    );
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    const result = await submitCateringRequestAction(buildRequestPayload(draft, selectedIds));
    setSubmitting(false);
    if (result.ok) setDone(true);
    else setSubmitError(result.error);
  }

  if (done) {
    return (
      <div role="status" className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6">
        <h2 className="font-display text-xl font-bold text-brand-ink">Request sent</h2>
        <p className="mt-2 text-sm text-brand-ink-muted">
          We sent your request to {selected.length} {selected.length === 1 ? "restaurant" : "restaurants"}.
          Quotes will appear in My catering requests as they arrive, and you&apos;ll get a
          notification in the bell.
        </p>
        <Link href="/account/catering" className={`${primaryBtn} mt-4 sm:inline-flex`}>
          View my catering requests
        </Link>
      </div>
    );
  }

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <Stepper step={step} />

      {step === 1 && (
        <form
          onSubmit={goToRestaurants}
          noValidate
          className="flex flex-col gap-5 rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cat-date" className={labelClass}>
                Event date
              </label>
              <input
                id="cat-date"
                type="date"
                min={today || undefined}
                value={draft.event_date}
                onChange={(e) => setField("event_date", e.target.value)}
                aria-invalid={Boolean(errors.event_date)}
                aria-describedby={errors.event_date ? "cat-date-err" : undefined}
                className={inputClass(Boolean(errors.event_date))}
              />
              <FieldError id="cat-date-err" message={errors.event_date} />
            </div>
            <div>
              <label htmlFor="cat-headcount" className={labelClass}>
                Number of people
              </label>
              <input
                id="cat-headcount"
                type="number"
                inputMode="numeric"
                min={1}
                max={CATERING_MAX_HEADCOUNT}
                value={draft.headcount}
                onChange={(e) => setField("headcount", e.target.value)}
                aria-invalid={Boolean(errors.headcount)}
                aria-describedby={errors.headcount ? "cat-headcount-err" : undefined}
                className={inputClass(Boolean(errors.headcount))}
              />
              <FieldError id="cat-headcount-err" message={errors.headcount} />
            </div>
          </div>

          <fieldset>
            <legend className={labelClass}>Delivery or pickup</legend>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              {(["delivery", "pickup"] as const).map((value) => (
                <label
                  key={value}
                  className={
                    "flex min-h-[44px] flex-1 cursor-pointer items-center gap-2 rounded-brand-control border px-3 text-sm font-medium " +
                    (draft.delivery_or_pickup === value
                      ? "border-brand-ink bg-brand-chip text-brand-ink"
                      : "border-brand-border bg-white text-brand-ink-muted")
                  }
                >
                  <input
                    type="radio"
                    name="cat-fulfillment"
                    value={value}
                    checked={draft.delivery_or_pickup === value}
                    onChange={() => setField("delivery_or_pickup", value)}
                    className="h-4 w-4"
                  />
                  {fulfillmentLabel(value)}
                </label>
              ))}
            </div>
            <FieldError id="cat-fulfillment-err" message={errors.delivery_or_pickup} />
          </fieldset>

          {draft.delivery_or_pickup === "delivery" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="cat-city" className={labelClass}>
                  Delivery city
                </label>
                <input
                  id="cat-city"
                  type="text"
                  maxLength={100}
                  autoComplete="address-level2"
                  value={draft.delivery_city}
                  onChange={(e) => setField("delivery_city", e.target.value)}
                  aria-invalid={Boolean(errors.delivery_city)}
                  aria-describedby={errors.delivery_city ? "cat-city-err" : undefined}
                  className={inputClass(Boolean(errors.delivery_city))}
                />
                <FieldError id="cat-city-err" message={errors.delivery_city} />
              </div>
              <div>
                <label htmlFor="cat-zip" className={labelClass}>
                  Delivery ZIP
                </label>
                <input
                  id="cat-zip"
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  autoComplete="postal-code"
                  value={draft.delivery_zip}
                  onChange={(e) => setField("delivery_zip", e.target.value)}
                  aria-invalid={Boolean(errors.delivery_zip)}
                  aria-describedby={errors.delivery_zip ? "cat-zip-err" : undefined}
                  className={inputClass(Boolean(errors.delivery_zip))}
                />
                <FieldError id="cat-zip-err" message={errors.delivery_zip} />
              </div>
            </div>
          )}

          <fieldset className="flex flex-col gap-3">
            <legend className={labelClass}>Items</legend>
            <p className="text-xs text-brand-ink-subtle">
              List what you&apos;d like and the tray size. Restaurants reply with one price for
              everything.
            </p>
            {errors.items && <FieldError id="cat-items-err" message={errors.items} />}
            <ul className="flex flex-col gap-3">
              {draft.items.map((item, index) => {
                const nameErr = errors[`items.${index}.item_name`];
                const sizeErr = errors[`items.${index}.size`];
                const qtyErr = errors[`items.${index}.quantity`];
                const noteErr = errors[`items.${index}.note`];
                return (
                  <li
                    key={item.key}
                    className="rounded-brand-control border border-brand-border bg-brand-bg p-3"
                  >
                    <p className="text-xs font-semibold text-brand-ink-subtle">Item {index + 1}</p>
                    <div className="mt-1 grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_6rem]">
                      <div>
                        <label htmlFor={`cat-item-${item.key}-name`} className={labelClass}>
                          Item name
                        </label>
                        <input
                          id={`cat-item-${item.key}-name`}
                          type="text"
                          maxLength={CATERING_ITEM_NAME_MAX}
                          value={item.item_name}
                          onChange={(e) => setItem(index, { item_name: e.target.value })}
                          aria-invalid={Boolean(nameErr)}
                          aria-describedby={nameErr ? `cat-item-${item.key}-name-err` : undefined}
                          className={inputClass(Boolean(nameErr))}
                        />
                        <FieldError id={`cat-item-${item.key}-name-err`} message={nameErr} />
                      </div>
                      <div>
                        <label htmlFor={`cat-item-${item.key}-size`} className={labelClass}>
                          Size
                        </label>
                        <select
                          id={`cat-item-${item.key}-size`}
                          value={item.size}
                          onChange={(e) =>
                            setItem(index, { size: e.target.value as ItemDraft["size"] })
                          }
                          aria-invalid={Boolean(sizeErr)}
                          aria-describedby={sizeErr ? `cat-item-${item.key}-size-err` : undefined}
                          className={inputClass(Boolean(sizeErr))}
                        >
                          <option value="">Choose...</option>
                          {SIZE_OPTIONS.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                        <FieldError id={`cat-item-${item.key}-size-err`} message={sizeErr} />
                      </div>
                      <div>
                        <label htmlFor={`cat-item-${item.key}-qty`} className={labelClass}>
                          Quantity
                        </label>
                        <input
                          id={`cat-item-${item.key}-qty`}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={CATERING_ITEM_QUANTITY_MAX}
                          value={item.quantity}
                          onChange={(e) => setItem(index, { quantity: e.target.value })}
                          aria-invalid={Boolean(qtyErr)}
                          aria-describedby={qtyErr ? `cat-item-${item.key}-qty-err` : undefined}
                          className={inputClass(Boolean(qtyErr))}
                        />
                        <FieldError id={`cat-item-${item.key}-qty-err`} message={qtyErr} />
                      </div>
                    </div>
                    <div className="mt-3">
                      <label htmlFor={`cat-item-${item.key}-note`} className={labelClass}>
                        Note <span className="font-normal text-brand-ink-subtle">(optional)</span>
                      </label>
                      <input
                        id={`cat-item-${item.key}-note`}
                        type="text"
                        maxLength={CATERING_ITEM_NOTE_MAX}
                        value={item.note}
                        onChange={(e) => setItem(index, { note: e.target.value })}
                        placeholder="e.g. mild, no onions"
                        aria-invalid={Boolean(noteErr)}
                        className={inputClass(Boolean(noteErr))}
                      />
                    </div>
                    {canRemoveItem(draft.items.length) && (
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        className="mt-2 flex min-h-[44px] items-center text-sm font-semibold text-brand-closed underline"
                      >
                        Remove item {index + 1}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {canAddItem(draft.items.length) && (
              <button type="button" onClick={addItem} className={`${secondaryBtn} self-start`}>
                Add another item
              </button>
            )}
          </fieldset>

          <div>
            <label htmlFor="cat-phone" className={labelClass}>
              Phone <span className="font-normal text-brand-ink-subtle">(optional)</span>
            </label>
            <input
              id="cat-phone"
              type="tel"
              autoComplete="tel"
              maxLength={20}
              value={draft.requester_phone}
              onChange={(e) => setField("requester_phone", e.target.value)}
              aria-describedby="cat-phone-hint"
              className={inputClass(Boolean(errors.requester_phone))}
            />
            <p id="cat-phone-hint" className="mt-1 text-xs text-brand-ink-subtle">
              Shared with a restaurant only after it sends you a quote.
            </p>
            <FieldError id="cat-phone-err" message={errors.requester_phone} />
          </div>

          <div>
            <label htmlFor="cat-notes" className={labelClass}>
              Anything else? <span className="font-normal text-brand-ink-subtle">(optional)</span>
            </label>
            <textarea
              id="cat-notes"
              rows={4}
              maxLength={CATERING_NOTES_MAX}
              value={draft.notes}
              onChange={(e) => setField("notes", e.target.value)}
              placeholder="Dietary needs, serving time, setup..."
              className={inputClass(Boolean(errors.notes))}
            />
            <p className="mt-1 text-right text-xs text-brand-ink-subtle">
              {draft.notes.length} / {CATERING_NOTES_MAX}
            </p>
          </div>

          {Object.keys(errors).length > 0 && (
            <p role="alert" className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
              Please fix the highlighted fields.
            </p>
          )}

          <button type="submit" className={`${primaryBtn} sm:self-start`}>
            Next: choose restaurants
          </button>
        </form>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4 rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6">
          <div>
            <h2 className="font-display text-lg font-bold text-brand-ink">Choose restaurants</h2>
            <p className="mt-1 text-sm text-brand-ink-muted">
              Only restaurants that accept catering requests are listed. Pick up to {max}.
            </p>
          </div>

          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch(1, city, q);
            }}
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
          >
            <div>
              <label htmlFor="cat-search-q" className={labelClass}>
                Restaurant name
              </label>
              <input
                id="cat-search-q"
                type="search"
                maxLength={100}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className={inputClass(false)}
              />
            </div>
            <div>
              <label htmlFor="cat-search-city" className={labelClass}>
                City
              </label>
              <input
                id="cat-search-city"
                type="text"
                maxLength={100}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className={inputClass(false)}
              />
            </div>
            <button type="submit" className={`${primaryBtn} sm:mt-[1.65rem]`}>
              Search
            </button>
          </form>

          <p
            role="status"
            aria-live="polite"
            className={
              "text-sm font-semibold " + (selected.length >= max ? "text-brand-accent" : "text-brand-ink")
            }
          >
            {selectionCounter(selected.length, max)}
            {capNotice && (
              <span className="ml-2 font-normal text-brand-closed">
                You can choose up to {max} restaurants. Deselect one to pick another.
              </span>
            )}
          </p>

          {searchError && (
            <p role="alert" className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
              {searchError}
            </p>
          )}

          {loading ? (
            <ul aria-label="Loading restaurants" className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <li key={i} className="h-14 animate-pulse rounded-brand-control bg-brand-chip" />
              ))}
            </ul>
          ) : results.length === 0 && !searchError ? (
            <p className="rounded-brand-control border border-dashed border-brand-border px-4 py-8 text-center text-sm text-brand-ink-muted">
              No restaurants match. Try a different name or city. Restaurants appear here once
              they accept catering requests.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {results.map((r) => {
                const checked = selectedIds.includes(r.location_id);
                const disabled = isRowDisabled(selectedIds, r.location_id, max);
                return (
                  <li key={r.location_id}>
                    <label
                      className={
                        "flex min-h-[56px] items-center gap-3 rounded-brand-control border px-3 py-2 " +
                        (checked
                          ? "border-brand-ink bg-brand-chip"
                          : "border-brand-border bg-white") +
                        (disabled ? " cursor-not-allowed opacity-60" : " cursor-pointer")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleRestaurant(r)}
                        className="h-5 w-5 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="block break-words text-sm font-semibold text-brand-ink">
                          {r.restaurant_name}
                        </span>
                        <span className="block text-xs text-brand-ink-subtle">
                          {r.city}, {r.state}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 text-sm">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => void runSearch(page - 1, city, q)}
                className={secondaryBtn}
              >
                Previous
              </button>
              <span className="text-brand-ink-subtle">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages || loading}
                onClick={() => void runSearch(page + 1, city, q)}
                className={secondaryBtn}
              >
                Next
              </button>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={() => setStep(1)} className={secondaryBtn}>
              Back
            </button>
            <button
              type="button"
              disabled={!canContinue(selectedIds, max)}
              onClick={() => setStep(3)}
              className={primaryBtn}
            >
              Next: review
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-5 rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6">
          <h2 className="font-display text-lg font-bold text-brand-ink">Review your request</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-brand-ink">Event date</dt>
              <dd className="text-brand-ink-muted">{formatEventDate(draft.event_date)}</dd>
            </div>
            <div>
              <dt className="font-semibold text-brand-ink">People</dt>
              <dd className="text-brand-ink-muted">{draft.headcount}</dd>
            </div>
            <div>
              <dt className="font-semibold text-brand-ink">Fulfilment</dt>
              <dd className="text-brand-ink-muted">
                {draft.delivery_or_pickup ? fulfillmentLabel(draft.delivery_or_pickup) : ""}
                {draft.delivery_or_pickup === "delivery" &&
                  [draft.delivery_city.trim(), draft.delivery_zip.trim()].filter(Boolean).length > 0 &&
                  ` to ${[draft.delivery_city.trim(), draft.delivery_zip.trim()].filter(Boolean).join(" ")}`}
              </dd>
            </div>
            {draft.notes.trim() && (
              <div className="sm:col-span-2">
                <dt className="font-semibold text-brand-ink">Notes</dt>
                <dd className="whitespace-pre-line break-words text-brand-ink-muted">{draft.notes.trim()}</dd>
              </div>
            )}
          </dl>
          <div>
            <h3 className="text-sm font-semibold text-brand-ink">Items</h3>
            <ul className="mt-1 list-disc pl-5 text-sm text-brand-ink-muted">
              {draft.items.map((item) => (
                <li key={item.key} className="break-words">
                  {itemLine({
                    item_name: item.item_name.trim(),
                    size: item.size === "" ? "other" : item.size,
                    quantity: Number(item.quantity),
                  })}
                  {item.note.trim() && ` — ${item.note.trim()}`}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-brand-ink">
              Sending to ({selectionCounter(selected.length, max)})
            </h3>
            <ul className="mt-1 list-disc pl-5 text-sm text-brand-ink-muted">
              {selected.map((r) => (
                <li key={r.location_id} className="break-words">
                  {r.restaurant_name}, {r.city}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-brand-ink-subtle">
            Restaurants see your first name and the details above. Your email{draft.requester_phone.trim() ? " and phone" : ""} are
            shared only with a restaurant that sends you a quote.
          </p>
          {submitError && (
            <p role="alert" className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
              {submitError}
            </p>
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={() => setStep(2)} disabled={submitting} className={secondaryBtn}>
              Back
            </button>
            <button type="button" onClick={submit} disabled={submitting} className={primaryBtn}>
              {submitting ? "Sending..." : "Send request"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
