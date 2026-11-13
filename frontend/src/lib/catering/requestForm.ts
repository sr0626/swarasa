// Validation + payload building for the "Request catering quote" form. Pure
// (no React / Next imports) so it runs under `node --test`. Mirrors the
// server bounds in backend/app/schemas/catering.py for fast feedback; the API
// stays the authority.
import type {
  CateringFulfillment,
  CateringItemInput,
  CateringItemSize,
  CateringRequestInput,
} from "@/types/catering";

const MAX_ITEMS = 30;
const MAX_HEADCOUNT = 5000;
const ITEM_NAME_MAX = 120;
const ITEM_NOTE_MAX = 255;
const QUANTITY_MAX = 100;
const NOTES_MAX = 2000;
const SIZES: readonly CateringItemSize[] = ["full_tray", "medium_tray", "flat_tray", "other"];

export interface ItemDraft {
  /** Stable React key (never sent to the API). */
  key: string;
  item_name: string;
  size: CateringItemSize | "";
  quantity: string;
  note: string;
}

export interface RequestDraft {
  event_date: string;
  headcount: string;
  delivery_or_pickup: CateringFulfillment | "";
  delivery_city: string;
  delivery_zip: string;
  requester_phone: string;
  notes: string;
  items: ItemDraft[];
}

/** field path -> message. Item fields use `items.<index>.<field>`. */
export type DraftErrors = Record<string, string>;

export function emptyItem(key: string): ItemDraft {
  return { key, item_name: "", size: "", quantity: "1", note: "" };
}

export function emptyDraft(firstItemKey: string): RequestDraft {
  return {
    event_date: "",
    headcount: "",
    delivery_or_pickup: "",
    delivery_city: "",
    delivery_zip: "",
    requester_phone: "",
    notes: "",
    items: [emptyItem(firstItemKey)],
  };
}

function isIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function parseWholeNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** `todayIso` is the viewer's local calendar date (YYYY-MM-DD), passed in so this stays pure. */
export function validateDraft(draft: RequestDraft, todayIso: string): DraftErrors {
  const errors: DraftErrors = {};

  if (!isIsoDate(draft.event_date)) {
    errors.event_date = "Choose the event date.";
  } else if (draft.event_date < todayIso) {
    errors.event_date = "The event date can't be in the past.";
  }

  const headcount = parseWholeNumber(draft.headcount);
  if (headcount === null || headcount < 1 || headcount > MAX_HEADCOUNT) {
    errors.headcount = `Enter the number of people (1 to ${MAX_HEADCOUNT}).`;
  }

  if (draft.delivery_or_pickup === "") {
    errors.delivery_or_pickup = "Choose delivery or pickup.";
  } else if (
    draft.delivery_or_pickup === "delivery" &&
    !draft.delivery_city.trim() &&
    !draft.delivery_zip.trim()
  ) {
    errors.delivery_city = "Enter the delivery city or ZIP code.";
  }

  const zip = draft.delivery_zip.trim();
  if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) {
    errors.delivery_zip = "Enter a 5-digit ZIP code.";
  }

  const phone = draft.requester_phone.trim();
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 11 || phone.length > 20) {
      errors.requester_phone = "Enter a 10-digit phone number, or leave it blank.";
    }
  }

  if (draft.notes.length > NOTES_MAX) {
    errors.notes = `Notes can be at most ${NOTES_MAX} characters.`;
  }

  if (draft.items.length === 0) {
    errors.items = "Add at least one item.";
  } else if (draft.items.length > MAX_ITEMS) {
    errors.items = `You can list at most ${MAX_ITEMS} items.`;
  }
  draft.items.forEach((item, index) => {
    const name = item.item_name.trim();
    if (!name) errors[`items.${index}.item_name`] = "Enter the item name.";
    else if (name.length > ITEM_NAME_MAX) {
      errors[`items.${index}.item_name`] = `At most ${ITEM_NAME_MAX} characters.`;
    }
    if (item.size === "" || !SIZES.includes(item.size)) {
      errors[`items.${index}.size`] = "Choose a size.";
    }
    const qty = parseWholeNumber(item.quantity);
    if (qty === null || qty < 1 || qty > QUANTITY_MAX) {
      errors[`items.${index}.quantity`] = `Quantity 1 to ${QUANTITY_MAX}.`;
    }
    if (item.note.length > ITEM_NOTE_MAX) {
      errors[`items.${index}.note`] = `At most ${ITEM_NOTE_MAX} characters.`;
    }
  });

  return errors;
}

export function isValid(errors: DraftErrors): boolean {
  return Object.keys(errors).length === 0;
}

function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Build the API body. Call only on a draft that passed `validateDraft`. */
export function buildRequestPayload(draft: RequestDraft, locationIds: readonly number[]): CateringRequestInput {
  const items: CateringItemInput[] = draft.items.map((item) => ({
    item_name: item.item_name.trim(),
    size: item.size as CateringItemSize,
    quantity: Number(item.quantity.trim()),
    note: orNull(item.note),
  }));
  const delivery = draft.delivery_or_pickup === "delivery";
  return {
    event_date: draft.event_date,
    headcount: Number(draft.headcount.trim()),
    delivery_or_pickup: draft.delivery_or_pickup as CateringFulfillment,
    delivery_city: delivery ? orNull(draft.delivery_city) : null,
    delivery_zip: delivery ? orNull(draft.delivery_zip) : null,
    requester_phone: orNull(draft.requester_phone),
    notes: orNull(draft.notes),
    items,
    location_ids: [...locationIds],
  };
}

/** Index of the first item a "remove" click should leave behind: never drop the last row. */
export function canRemoveItem(itemCount: number): boolean {
  return itemCount > 1;
}

export function canAddItem(itemCount: number): boolean {
  return itemCount < MAX_ITEMS;
}
