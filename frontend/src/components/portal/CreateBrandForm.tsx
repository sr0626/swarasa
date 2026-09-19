"use client";

// "Add your restaurant" form — creates the restaurant brand AND its first
// location in one submit (POST /restaurants then POST /locations, chained
// in app/portal/brands/new/actions.ts, which also geocodes the address
// server-side so the listing is visible to geo search).
// Backs app/portal/brands/new/page.tsx, the landing spot for the site
// header's "Add Your Restaurant" CTA when a signed-in owner clicks it
// (TopBarShell.tsx) and for the business account page's own "create a new
// brand" empty-state link (components/portal/OwnerRestaurantsSection.tsx).
//
// Validation: the same zod schema (lib/validation/restaurant.ts
// `addRestaurantSchema`) runs here for instant field-level errors and again
// in the server action (the real gate).
//
// Partial failure: if the brand is created but the location step fails, the
// action returns the new `brandId`. The form then locks the restaurant
// fields, keeps the address the owner typed, and retries ONLY the location
// step (never a second brand). The owner can also leave for the dashboard,
// where BrandCard shows "No locations yet" for the brand.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addRestaurantAction } from "@/app/portal/brands/new/actions";
import { fieldErrorsFromZod, type FieldErrors } from "@/lib/validation/fieldErrors";
import { addRestaurantSchema } from "@/lib/validation/restaurant";
import type { CuisineCategory, CuisineTag } from "@/types/cuisine";

const CATEGORY_LABEL: Record<CuisineCategory, string> = {
  regional: "Regional cuisine",
  dietary: "Dietary",
  type: "Restaurant type",
  signature: "Signature dishes",
  dining_time: "Dining time",
};

const CATEGORY_ORDER: CuisineCategory[] = [
  "regional",
  "type",
  "dietary",
  "signature",
  "dining_time",
];

const inputBase =
  "mt-1.5 min-h-[44px] w-full rounded-brand-control border bg-white px-3 py-2.5 text-base text-brand-ink placeholder:text-brand-placeholder focus:outline-none read-only:bg-brand-chip read-only:text-brand-ink-muted sm:text-sm";
const labelClass = "text-sm font-semibold text-brand-ink";

function inputClass(hasError: boolean): string {
  return `${inputBase} ${
    hasError ? "border-brand-closed focus:border-brand-closed" : "border-brand-border focus:border-brand-accent"
  }`;
}

function groupByCategory(tags: CuisineTag[]): Map<CuisineCategory, CuisineTag[]> {
  const groups = new Map<CuisineCategory, CuisineTag[]>();
  for (const tag of tags) {
    const list = groups.get(tag.category) ?? [];
    list.push(tag);
    groups.set(tag.category, list);
  }
  return groups;
}

interface FormValues {
  name: string;
  description: string;
  website: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  phone: string;
}

const EMPTY_VALUES: FormValues = {
  name: "",
  description: "",
  website: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  postal_code: "",
  phone: "",
};

interface FieldProps {
  id: keyof FormValues;
  label: string;
  hint?: string;
  optional?: boolean;
  error?: string;
  children: (props: {
    id: string;
    className: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
    "aria-required": boolean;
  }) => React.ReactNode;
}

function Field({ id, label, hint, optional, error, children }: FieldProps) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
        {optional && <span className="ml-1 font-normal text-brand-ink-subtle">(optional)</span>}
      </label>
      {children({
        id,
        className: inputClass(Boolean(error)),
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy || undefined,
        "aria-required": !optional,
      })}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-brand-ink-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs font-medium text-brand-closed">
          {error}
        </p>
      )}
    </div>
  );
}

export default function CreateBrandForm({ cuisineTags }: { cuisineTags: CuisineTag[] }) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the brand exists but its location doesn't yet (partial failure).
  const [createdBrandId, setCreatedBrandId] = useState<number | null>(null);

  const groups = groupByCategory(cuisineTags);
  const brandLocked = createdBrandId !== null;

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  function toggleTag(id: number) {
    if (brandLocked) return;
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    if (fieldErrors.cuisine_tag_ids) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next.cuisine_tag_ids;
        return next;
      });
    }
  }

  function focusFirstError(errors: FieldErrors) {
    const first = Object.keys(errors).find((key) => key !== "_form");
    if (!first) return;
    // cuisine_tag_ids has no single input; its heading is focusable.
    const id = first === "cuisine_tag_ids" ? "cuisine-tags-heading" : first;
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const input = { ...values, cuisine_tag_ids: Array.from(selectedTagIds) };
    const parsed = addRestaurantSchema.safeParse(input);
    if (!parsed.success) {
      const errors = fieldErrorsFromZod(parsed.error);
      setFieldErrors(errors);
      setError("Please fix the highlighted fields and try again.");
      focusFirstError(errors);
      return;
    }
    setFieldErrors({});

    setSaving(true);
    try {
      const result = await addRestaurantAction(input, createdBrandId ?? undefined);
      if (result.ok) {
        router.push(`/portal/locations/${result.locationId}?new=${result.mapPosition}`);
        return;
      }
      if (result.brandId !== undefined) setCreatedBrandId(result.brandId);
      if (result.fieldErrors) {
        setFieldErrors(result.fieldErrors);
        focusFirstError(result.fieldErrors);
      }
      setError(result.error);
      setSaving(false);
    } catch {
      setError(
        brandLocked
          ? "Something went wrong saving the address. Please try again."
          : "Something went wrong creating your restaurant. Please try again."
      );
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-8">
      {brandLocked && (
        <div
          role="status"
          className="rounded-brand-control border border-brand-border bg-brand-chip px-3 py-3 text-sm text-brand-ink"
        >
          <p className="font-semibold">Your restaurant was created.</p>
          <p className="mt-1 text-brand-ink-muted">
            Only its address is left. Fix it below and try again — we won&rsquo;t create the
            restaurant a second time. Or{" "}
            <Link href="/account" className="font-semibold text-brand-accent underline">
              finish later from your business account
            </Link>
            .
          </p>
        </div>
      )}

      <fieldset className="flex flex-col gap-5">
        <legend className="mb-4 font-display text-lg font-bold text-brand-ink">Restaurant</legend>

        <Field id="name" label="Restaurant name" error={fieldErrors.name}>
          {(props) => (
            <input
              {...props}
              type="text"
              maxLength={200}
              autoComplete="organization"
              readOnly={brandLocked}
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Spice Garden"
            />
          )}
        </Field>

        <Field id="description" label="Description" error={fieldErrors.description}>
          {(props) => (
            <textarea
              {...props}
              rows={4}
              maxLength={2000}
              readOnly={brandLocked}
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What makes your restaurant worth a visit?"
            />
          )}
        </Field>

        <Field
          id="website"
          label="Website"
          optional
          error={fieldErrors.website}
          hint="Your restaurant's own site, if you have one."
        >
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={500}
              autoComplete="url"
              readOnly={brandLocked}
              value={values.website}
              onChange={(e) => set("website", e.target.value)}
              placeholder="https://www.spicegarden.com"
            />
          )}
        </Field>

        <div>
          <p id="cuisine-tags-heading" tabIndex={-1} className={`${labelClass} focus:outline-none`}>
            Cuisine tags
          </p>
          {cuisineTags.length === 0 ? (
            <p className="mt-1.5 text-sm text-brand-ink-muted">
              Cuisine tags aren&rsquo;t available right now — you can add them later from your business account.
            </p>
          ) : (
            <div className="mt-2 flex flex-col gap-4">
              {CATEGORY_ORDER.filter((category) => groups.has(category)).map((category) => (
                <div key={category}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
                    {CATEGORY_LABEL[category]}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {groups.get(category)!.map((tag) => {
                      const selected = selectedTagIds.has(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          aria-pressed={selected}
                          disabled={brandLocked}
                          onClick={() => toggleTag(tag.id)}
                          className={`min-h-[44px] rounded-brand-pill px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${
                            selected
                              ? "bg-brand-accent text-white"
                              : "bg-brand-chip text-brand-chip-ink hover:bg-brand-border"
                          } ${brandLocked && !selected ? "opacity-50" : ""}`}
                        >
                          {tag.display_name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          {fieldErrors.cuisine_tag_ids && (
            <p role="alert" className="mt-2 text-xs font-medium text-brand-closed">
              {fieldErrors.cuisine_tag_ids}
            </p>
          )}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-5">
        <legend className="mb-4 font-display text-lg font-bold text-brand-ink">Location</legend>
        <p className="text-sm text-brand-ink-muted">
          Where diners can find you. We use the address to place your restaurant on the map, so
          it shows up in nearby searches. You can add more locations later.
        </p>

        <Field id="address_line1" label="Street address" error={fieldErrors.address_line1}>
          {(props) => (
            <input
              {...props}
              type="text"
              maxLength={200}
              autoComplete="address-line1"
              value={values.address_line1}
              onChange={(e) => set("address_line1", e.target.value)}
              placeholder="123 Main St"
            />
          )}
        </Field>

        <Field
          id="address_line2"
          label="Suite / unit"
          optional
          error={fieldErrors.address_line2}
        >
          {(props) => (
            <input
              {...props}
              type="text"
              maxLength={200}
              autoComplete="address-line2"
              value={values.address_line2}
              onChange={(e) => set("address_line2", e.target.value)}
              placeholder="Suite 150"
            />
          )}
        </Field>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-6">
          <div className="sm:col-span-3">
            <Field id="city" label="City" error={fieldErrors.city}>
              {(props) => (
                <input
                  {...props}
                  type="text"
                  maxLength={100}
                  autoComplete="address-level2"
                  value={values.city}
                  onChange={(e) => set("city", e.target.value)}
                  placeholder="Irving"
                />
              )}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:col-span-3">
            <Field id="state" label="State" error={fieldErrors.state}>
              {(props) => (
                <input
                  {...props}
                  type="text"
                  maxLength={2}
                  autoComplete="address-level1"
                  autoCapitalize="characters"
                  value={values.state}
                  onChange={(e) => set("state", e.target.value.toUpperCase())}
                  placeholder="TX"
                />
              )}
            </Field>
            <Field id="postal_code" label="ZIP code" error={fieldErrors.postal_code}>
              {(props) => (
                <input
                  {...props}
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  autoComplete="postal-code"
                  value={values.postal_code}
                  onChange={(e) => set("postal_code", e.target.value)}
                  placeholder="75063"
                />
              )}
            </Field>
          </div>
        </div>

        <Field
          id="phone"
          label="Phone"
          optional
          error={fieldErrors.phone}
          hint="Shown on your listing so diners can call you."
        >
          {(props) => (
            <input
              {...props}
              type="tel"
              inputMode="tel"
              maxLength={20}
              autoComplete="tel"
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="(972) 555-0142"
            />
          )}
        </Field>
      </fieldset>

      {error && (
        <p
          role="alert"
          className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {error}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={saving}
          className="flex min-h-[44px] w-full items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {saving
            ? "Creating..."
            : brandLocked
              ? "Save address"
              : "Create restaurant"}
        </button>
        {saving && (
          <p role="status" className="mt-2 text-xs text-brand-ink-subtle">
            Setting up your listing and finding it on the map — this can take a few seconds.
          </p>
        )}
      </div>
    </form>
  );
}
