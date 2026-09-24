// Small form pieces shared by the "Add restaurant" form (CreateBrandForm.tsx)
// and the "Add location" form (AddLocationForm.tsx): the labelled field
// wrapper with an inline error/hint, and the street-address + phone block
// both forms need (so the address wording, autocomplete hints and the phone
// rule can't drift between them).
import type { FieldErrors } from "@/lib/validation/fieldErrors";

const inputBase =
  "mt-1.5 min-h-[44px] w-full rounded-brand-control border bg-white px-3 py-2.5 text-base text-brand-ink placeholder:text-brand-placeholder focus:outline-none read-only:bg-brand-chip read-only:text-brand-ink-muted sm:text-sm";
export const labelClass = "text-sm font-semibold text-brand-ink";

export function inputClass(hasError: boolean): string {
  return `${inputBase} ${
    hasError ? "border-brand-closed focus:border-brand-closed" : "border-brand-border focus:border-brand-accent"
  }`;
}

/** The address + phone values both forms hold. */
export interface LocationFieldValues {
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  phone: string;
}

export const EMPTY_LOCATION_VALUES: LocationFieldValues = {
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  postal_code: "",
  phone: "",
};

interface FieldProps {
  id: string;
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

export function Field({ id, label, hint, optional, error, children }: FieldProps) {
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

/** Street address, city/state/ZIP and phone — the "where" half of both forms. */
export function LocationFields({
  values,
  errors,
  onChange,
}: {
  values: LocationFieldValues;
  errors: FieldErrors;
  onChange: <K extends keyof LocationFieldValues>(key: K, value: LocationFieldValues[K]) => void;
}) {
  return (
    <>
      <Field id="address_line1" label="Street address" error={errors.address_line1}>
        {(props) => (
          <input
            {...props}
            type="text"
            maxLength={200}
            autoComplete="address-line1"
            value={values.address_line1}
            onChange={(e) => onChange("address_line1", e.target.value)}
            placeholder="123 Main St"
          />
        )}
      </Field>

      <Field id="address_line2" label="Suite / unit" optional error={errors.address_line2}>
        {(props) => (
          <input
            {...props}
            type="text"
            maxLength={200}
            autoComplete="address-line2"
            value={values.address_line2}
            onChange={(e) => onChange("address_line2", e.target.value)}
            placeholder="Suite 150"
          />
        )}
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-6">
        <div className="sm:col-span-3">
          <Field id="city" label="City" error={errors.city}>
            {(props) => (
              <input
                {...props}
                type="text"
                maxLength={100}
                autoComplete="address-level2"
                value={values.city}
                onChange={(e) => onChange("city", e.target.value)}
                placeholder="Irving"
              />
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:col-span-3">
          <Field id="state" label="State" error={errors.state}>
            {(props) => (
              <input
                {...props}
                type="text"
                maxLength={2}
                autoComplete="address-level1"
                autoCapitalize="characters"
                value={values.state}
                onChange={(e) => onChange("state", e.target.value.toUpperCase())}
                placeholder="TX"
              />
            )}
          </Field>
          <Field id="postal_code" label="ZIP code" error={errors.postal_code}>
            {(props) => (
              <input
                {...props}
                type="text"
                inputMode="numeric"
                maxLength={10}
                autoComplete="postal-code"
                value={values.postal_code}
                onChange={(e) => onChange("postal_code", e.target.value)}
                placeholder="75063"
              />
            )}
          </Field>
        </div>
      </div>

      <Field
        id="phone"
        label="Phone"
        error={errors.phone}
        hint="A 10-digit US number, shown on your listing so diners can call you."
      >
        {(props) => (
          <input
            {...props}
            type="tel"
            inputMode="tel"
            maxLength={40}
            autoComplete="tel"
            value={values.phone}
            onChange={(e) => onChange("phone", e.target.value)}
            placeholder="(972) 555-0142"
          />
        )}
      </Field>
    </>
  );
}
