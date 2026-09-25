"use client";

// Owner/manager/admin menu editor for the location editor page —
// docs/API_CONTRACTS.md "Menu (`menu_section`, `menu_item`)".
//
// Free-tier feature: deliberately no `is_paid` prop, check, upsell or copy
// anywhere in this file (the full menu with prices is free for every
// listing — docs/DECISIONS.md "Full menu with prices moved to free tier").
//
// Structure: optional named GROUPS (each with an optional description) hold
// ITEMS; an item can also sit in no group ("Items without a group", shown
// first). An item has a name (required), optional description, and EITHER
// one free-text price OR 1-6 sizes each with a name and a price. Everything
// is free text — a price is never parsed as a number.
//
// Photos: the per-item photo control renders ONLY when the API says the
// platform flag is on (`menu.menu_photos_enabled`); while it is off there is
// no photo UI at all and the API returns no photo URLs.
//
// Hide / show (never deletes): each item, each group (hides its items too) and
// the ENTIRE menu can be hidden from diners with one click and shown again the
// same way. Hidden things stay in this editor, marked "Hidden". Toggles are
// instant and optimistic (reverted with an error if the server refuses).
//
// After every successful write the whole menu is re-read from the server
// (or taken from the reorder response) so the editor can never drift from
// what the public sees. Deletes are two-step (click, then confirm).
import { useRef, useState } from "react";
import {
  createMenuItemAction,
  createMenuSectionAction,
  deleteMenuItemAction,
  deleteMenuSectionAction,
  getLocationMenuAction,
  getMenuPhotoUploadUrlAction,
  removeMenuItemPhotoAction,
  reorderMenuItemsAction,
  setMenuHiddenAction,
  setMenuItemHiddenAction,
  setMenuSectionHiddenAction,
  reorderMenuSectionsAction,
  setMenuItemPhotoAction,
  updateMenuItemAction,
  updateMenuSectionAction,
} from "@/app/portal/locations/[id]/actions";
import {
  ChevronDownIcon,
  ImageIcon,
  MenuBookIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/ui/icons";
import { formatItemPrice, moveId, moveRow } from "@/lib/menu/format";
import {
  countHidden,
  hiddenSummary,
  withItemHidden,
  withSectionHidden,
} from "@/lib/menu/visibility";
import {
  HiddenChip,
  SectionVisibilityBar,
  VisibilityToggleButton,
} from "@/components/portal/VisibilityControls";
import { postFileToS3 } from "@/lib/photoUpload";
import {
  MENU_LIMITS,
  MENU_PHOTO_MAX_BYTES,
  MENU_PHOTO_TYPES,
  menuSectionSchema,
  validateMenuItemForm,
  type MenuItemFormErrors,
  type MenuItemFormState,
  type PriceMode,
} from "@/lib/validation/menu";
import { fieldErrorsFromZod, type FieldErrors } from "@/lib/validation/fieldErrors";
import type { MenuItem, MenuResponse, MenuSectionWithItems } from "@/types/menu";
import { SECTION_ANCHOR_CLASS } from "@/components/portal/editorSectionAnchor";

const errorTextClass = "mt-1 text-xs font-medium text-brand-closed";
const inputClass =
  "mt-1.5 min-h-[44px] w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-base text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none sm:text-sm";
const labelClass = "text-sm font-semibold text-brand-ink";
const rowButton =
  "flex min-h-[44px] items-center gap-1.5 rounded-brand-control border border-brand-border bg-white px-3 text-xs font-semibold text-brand-ink transition hover:border-brand-ink-subtle disabled:cursor-not-allowed disabled:opacity-60";
const iconButton =
  "flex h-11 w-11 items-center justify-center rounded-brand-control border border-brand-border bg-white text-brand-ink transition hover:border-brand-ink-subtle disabled:cursor-not-allowed disabled:opacity-40";
const primaryButton =
  "flex min-h-[44px] items-center justify-center gap-2 rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton =
  "flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border bg-white px-5 text-sm font-semibold text-brand-ink transition hover:border-brand-ink-subtle disabled:opacity-60";
const dangerButton =
  "flex min-h-[44px] items-center gap-1.5 rounded-brand-control border border-brand-closed px-3 text-xs font-semibold text-brand-closed transition hover:bg-brand-closed-bg disabled:cursor-not-allowed disabled:opacity-60";
const dangerSolidButton =
  "flex min-h-[44px] items-center gap-1.5 rounded-brand-control bg-brand-closed px-3 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

const EMPTY_ITEM_FORM: MenuItemFormState = {
  name: "",
  description: "",
  priceMode: "single",
  price: "",
  sizes: [],
  section_id: null,
};

const NO_ITEM_ERRORS: MenuItemFormErrors = { sizeRows: [] };

interface SectionFormState {
  name: string;
  description: string;
}

function formFromItem(item: MenuItem): MenuItemFormState {
  return {
    name: item.name,
    description: item.description ?? "",
    priceMode: item.sizes && item.sizes.length > 0 ? "sizes" : "single",
    price: item.price ?? "",
    sizes: item.sizes ? item.sizes.map((s) => ({ ...s })) : [],
    section_id: item.section_id,
  };
}

/** "new" or an existing id, for whichever item/group form is open. */
type EditTarget = "new" | number;

/** Focus (and thereby scroll to) a just-opened form's first field once React
 * has rendered it. */
function focusSoon(id: string): void {
  setTimeout(() => document.getElementById(id)?.focus(), 0);
}

export default function LocationMenuManager({
  locationId,
  initialMenu,
}: {
  locationId: number;
  initialMenu: MenuResponse;
}) {
  const [menu, setMenu] = useState<MenuResponse>(initialMenu);
  const [listError, setListError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // -- group form ----------------------------------------------------------
  const [sectionEditing, setSectionEditing] = useState<EditTarget | null>(null);
  const [sectionForm, setSectionForm] = useState<SectionFormState>({ name: "", description: "" });
  const [sectionErrors, setSectionErrors] = useState<FieldErrors>({});
  const [sectionFormError, setSectionFormError] = useState<string | null>(null);
  const [sectionSaving, setSectionSaving] = useState(false);

  // -- item form -----------------------------------------------------------
  const [itemEditing, setItemEditing] = useState<EditTarget | null>(null);
  const [itemForm, setItemForm] = useState<MenuItemFormState>(EMPTY_ITEM_FORM);
  const [itemErrors, setItemErrors] = useState<MenuItemFormErrors>(NO_ITEM_ERRORS);
  const [itemFormError, setItemFormError] = useState<string | null>(null);
  const [itemSaving, setItemSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // -- delete confirmations ------------------------------------------------
  const [confirmItemId, setConfirmItemId] = useState<number | null>(null);
  const [confirmSectionId, setConfirmSectionId] = useState<number | null>(null);

  const photosOn = menu.menu_photos_enabled;
  const anyFormOpen = sectionEditing !== null || itemEditing !== null;
  const totalItems =
    menu.ungrouped_items.length + menu.sections.reduce((n, s) => n + s.items.length, 0);
  const isEmpty = totalItems === 0 && menu.sections.length === 0;

  async function refreshMenu(): Promise<boolean> {
    const result = await getLocationMenuAction(locationId);
    if (result.ok) {
      setMenu(result.data);
      return true;
    }
    setListError(result.error);
    return false;
  }

  // ---------------------------------------------------------------------
  // Hide / show (instant + optimistic; reverts on failure)
  // ---------------------------------------------------------------------

  async function toggleItemHidden(item: MenuItem) {
    const next = !item.is_hidden;
    const previous = menu;
    setListError(null);
    setMenu(withItemHidden(menu, item.id, next));
    setBusyKey(`vis-item-${item.id}`);
    try {
      const result = await setMenuItemHiddenAction(locationId, item.id, next);
      if (!result.ok) {
        setMenu(previous);
        setListError(result.error);
      }
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleSectionHidden(section: MenuSectionWithItems) {
    const next = !section.is_hidden;
    const previous = menu;
    setListError(null);
    setMenu(withSectionHidden(menu, section.id, next));
    setBusyKey(`vis-section-${section.id}`);
    try {
      const result = await setMenuSectionHiddenAction(locationId, section.id, next);
      if (!result.ok) {
        setMenu(previous);
        setListError(result.error);
      }
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleMenuHidden() {
    const next = !menu.menu_hidden;
    const previous = menu;
    setListError(null);
    setMenu({ ...menu, menu_hidden: next });
    setBusyKey("vis-menu");
    try {
      const result = await setMenuHiddenAction(locationId, next);
      if (!result.ok) {
        setMenu(previous);
        setListError(result.error);
      }
    } finally {
      setBusyKey(null);
    }
  }

  // ---------------------------------------------------------------------
  // Group form
  // ---------------------------------------------------------------------

  function openNewSection() {
    setSectionForm({ name: "", description: "" });
    setSectionErrors({});
    setSectionFormError(null);
    closeItemForm();
    setListError(null);
    setSectionEditing("new");
    focusSoon("menu-section-name");
  }

  function openEditSection(section: MenuSectionWithItems) {
    setSectionForm({ name: section.name, description: section.description ?? "" });
    setSectionErrors({});
    setSectionFormError(null);
    closeItemForm();
    setListError(null);
    setConfirmSectionId(null);
    setSectionEditing(section.id);
    focusSoon("menu-section-name");
  }

  function closeSectionForm() {
    setSectionEditing(null);
    setSectionErrors({});
    setSectionFormError(null);
  }

  async function submitSection(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSectionFormError(null);
    const check = menuSectionSchema.safeParse(sectionForm);
    if (!check.success) {
      const errors = fieldErrorsFromZod(check.error);
      setSectionErrors(errors);
      document.getElementById("menu-section-name")?.focus();
      return;
    }
    setSectionErrors({});
    setSectionSaving(true);
    try {
      const result =
        sectionEditing === "new"
          ? await createMenuSectionAction(locationId, sectionForm)
          : await updateMenuSectionAction(locationId, sectionEditing as number, sectionForm);
      if (!result.ok) {
        setSectionFormError(result.error);
        return;
      }
      await refreshMenu();
      closeSectionForm();
    } finally {
      setSectionSaving(false);
    }
  }

  function renderSectionForm() {
    return (
      <form
        onSubmit={submitSection}
        noValidate
        className="flex flex-col gap-4 rounded-brand-control border border-brand-border bg-brand-bg p-4"
      >
        <h3 className="font-display text-base font-semibold text-brand-ink">
          {sectionEditing === "new" ? "New group" : "Edit group"}
        </h3>
        <div>
          <label htmlFor="menu-section-name" className={labelClass}>
            Group name
          </label>
          <input
            id="menu-section-name"
            type="text"
            required
            aria-required="true"
            aria-invalid={sectionErrors.name ? true : undefined}
            aria-describedby={sectionErrors.name ? "menu-section-name-error" : undefined}
            maxLength={MENU_LIMITS.sectionName}
            value={sectionForm.name}
            onChange={(e) => {
              setSectionForm((p) => ({ ...p, name: e.target.value }));
              setSectionErrors((p) => ({ ...p, name: "" }));
            }}
            placeholder="e.g. Appetizers, Main Course"
            className={inputClass}
          />
          {sectionErrors.name && (
            <p id="menu-section-name-error" role="alert" className={errorTextClass}>
              {sectionErrors.name}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="menu-section-description" className={labelClass}>
            Description <span className="font-normal text-brand-ink-subtle">(optional)</span>
          </label>
          <textarea
            id="menu-section-description"
            rows={2}
            maxLength={MENU_LIMITS.sectionDescription}
            value={sectionForm.description}
            onChange={(e) => setSectionForm((p) => ({ ...p, description: e.target.value }))}
            placeholder="e.g. All main courses are served with basmati rice"
            className={inputClass}
          />
          {sectionErrors.description && (
            <p role="alert" className={errorTextClass}>
              {sectionErrors.description}
            </p>
          )}
        </div>
        {sectionFormError && (
          <p className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
            {sectionFormError}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={sectionSaving} className={primaryButton}>
            {sectionSaving ? "Saving..." : sectionEditing === "new" ? "Add group" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={closeSectionForm}
            disabled={sectionSaving}
            className={secondaryButton}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  async function moveSection(index: number, direction: -1 | 1) {
    setListError(null);
    setBusyKey("sections");
    try {
      const ids = moveId(
        menu.sections.map((s) => s.id),
        index,
        direction
      );
      const result = await reorderMenuSectionsAction(locationId, ids);
      if (result.ok) setMenu(result.data);
      else {
        setListError(result.error);
        await refreshMenu();
      }
    } finally {
      setBusyKey(null);
    }
  }

  async function removeSection(section: MenuSectionWithItems, deleteItems: boolean) {
    setListError(null);
    setBusyKey(`section-${section.id}`);
    try {
      const result = await deleteMenuSectionAction(locationId, section.id, deleteItems);
      if (!result.ok) {
        setListError(result.error);
        return;
      }
      await refreshMenu();
    } finally {
      setBusyKey(null);
      setConfirmSectionId(null);
    }
  }

  // ---------------------------------------------------------------------
  // Item form
  // ---------------------------------------------------------------------

  function openNewItem(sectionId: number | null) {
    setItemForm({ ...EMPTY_ITEM_FORM, section_id: sectionId });
    setItemErrors(NO_ITEM_ERRORS);
    setItemFormError(null);
    setPhotoError(null);
    closeSectionForm();
    setListError(null);
    setItemEditing("new");
    focusSoon("menu-item-name");
  }

  function openEditItem(item: MenuItem) {
    setItemForm(formFromItem(item));
    setItemErrors(NO_ITEM_ERRORS);
    setItemFormError(null);
    setPhotoError(null);
    closeSectionForm();
    setListError(null);
    setConfirmItemId(null);
    setItemEditing(item.id);
    focusSoon("menu-item-name");
  }

  function closeItemForm() {
    setItemEditing(null);
    setItemErrors(NO_ITEM_ERRORS);
    setItemFormError(null);
    setPhotoError(null);
  }

  function patchItemForm(patch: Partial<MenuItemFormState>) {
    setItemForm((prev) => ({ ...prev, ...patch }));
    setItemErrors((prev) => {
      const next = { ...prev };
      if ("name" in patch) delete next.name;
      if ("description" in patch) delete next.description;
      if ("price" in patch || "priceMode" in patch) delete next.price;
      if ("sizes" in patch || "priceMode" in patch) {
        delete next.sizes;
        next.sizeRows = [];
      }
      return next;
    });
  }

  function switchPriceMode(mode: PriceMode) {
    if (mode === itemForm.priceMode) return;
    // Entering sizes mode with nothing yet: start with one blank row so the
    // owner sees where to type.
    const sizes =
      mode === "sizes" && itemForm.sizes.length === 0 ? [{ label: "", price: "" }] : itemForm.sizes;
    patchItemForm({ priceMode: mode, sizes });
  }

  function setSizeField(index: number, field: "label" | "price", value: string) {
    patchItemForm({
      sizes: itemForm.sizes.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    });
  }

  async function submitItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setItemFormError(null);
    const check = validateMenuItemForm(itemForm);
    if (!check.ok) {
      setItemErrors(check.errors);
      const e2 = check.errors;
      let focusId: string | null = null;
      if (e2.name) focusId = "menu-item-name";
      else if (e2.price) focusId = "menu-item-price";
      else {
        const badRow = e2.sizeRows.findIndex((r) => r.label || r.price);
        if (badRow >= 0) focusId = `menu-item-size-${badRow}-${e2.sizeRows[badRow]?.label ? "label" : "price"}`;
        else if (e2.sizes) focusId = "menu-item-add-size";
      }
      if (focusId) document.getElementById(focusId)?.focus();
      return;
    }
    setItemErrors(NO_ITEM_ERRORS);
    setItemSaving(true);
    try {
      // Same payload for create and edit (the form always manages every
      // field, so an edit is a full replacement; the server clears whichever
      // pricing form isn't sent).
      const result =
        itemEditing === "new"
          ? await createMenuItemAction(locationId, check.value)
          : await updateMenuItemAction(locationId, itemEditing as number, check.value);
      if (!result.ok) {
        setItemFormError(result.error);
        return;
      }
      await refreshMenu();
      closeItemForm();
    } finally {
      setItemSaving(false);
    }
  }

  async function moveItem(sectionId: number | null, items: MenuItem[], index: number, direction: -1 | 1) {
    setListError(null);
    setBusyKey(`items-${sectionId ?? "none"}`);
    try {
      const ids = moveId(
        items.map((i) => i.id),
        index,
        direction
      );
      const result = await reorderMenuItemsAction(locationId, sectionId, ids);
      if (result.ok) setMenu(result.data);
      else {
        setListError(result.error);
        await refreshMenu();
      }
    } finally {
      setBusyKey(null);
    }
  }

  async function removeItem(item: MenuItem) {
    if (confirmItemId !== item.id) {
      setConfirmItemId(item.id);
      return;
    }
    setListError(null);
    setBusyKey(`item-${item.id}`);
    try {
      const result = await deleteMenuItemAction(locationId, item.id);
      if (!result.ok) {
        setListError(result.error);
        return;
      }
      if (itemEditing === item.id) closeItemForm();
      await refreshMenu();
    } finally {
      setBusyKey(null);
      setConfirmItemId(null);
    }
  }

  // ---------------------------------------------------------------------
  // Photos (only reachable while `menu_photos_enabled`)
  // ---------------------------------------------------------------------

  async function handlePhotoFile(item: MenuItem, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError(null);
    if (!(MENU_PHOTO_TYPES as readonly string[]).includes(file.type)) {
      setPhotoError("Only JPEG or PNG images are supported.");
    } else if (file.size > MENU_PHOTO_MAX_BYTES) {
      setPhotoError("Photos must be 2 MB or smaller.");
    } else {
      setPhotoBusy(true);
      try {
        const upload = await getMenuPhotoUploadUrlAction(locationId, file.type);
        if (!upload.ok) {
          setPhotoError(upload.error);
        } else if (!(await postFileToS3(upload.data.upload_url, upload.data.fields, file))) {
          setPhotoError("Uploading the image failed. Please try again.");
        } else {
          const attached = await setMenuItemPhotoAction(locationId, item.id, upload.data.s3_key);
          if (attached.ok) await refreshMenu();
          else setPhotoError(attached.error);
        }
      } finally {
        setPhotoBusy(false);
      }
    }
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  async function handleRemovePhoto(item: MenuItem) {
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const result = await removeMenuItemPhotoAction(locationId, item.id);
      if (result.ok) await refreshMenu();
      else setPhotoError(result.error);
    } finally {
      setPhotoBusy(false);
    }
  }

  function findItem(id: number): MenuItem | undefined {
    return (
      menu.ungrouped_items.find((i) => i.id === id) ??
      menu.sections.flatMap((s) => s.items).find((i) => i.id === id)
    );
  }

  function renderItemForm() {
    const editingItem = typeof itemEditing === "number" ? findItem(itemEditing) : undefined;
    const rowErrors = itemErrors.sizeRows;
    return (
      <form
        onSubmit={submitItem}
        noValidate
        className="flex flex-col gap-4 rounded-brand-control border border-brand-border bg-brand-bg p-4"
      >
        <h3 className="font-display text-base font-semibold text-brand-ink">
          {itemEditing === "new" ? "New item" : "Edit item"}
        </h3>

        <div>
          <label htmlFor="menu-item-name" className={labelClass}>
            Name
          </label>
          <input
            id="menu-item-name"
            type="text"
            required
            aria-required="true"
            aria-invalid={itemErrors.name ? true : undefined}
            aria-describedby={itemErrors.name ? "menu-item-name-error" : undefined}
            maxLength={MENU_LIMITS.itemName}
            value={itemForm.name}
            onChange={(e) => patchItemForm({ name: e.target.value })}
            placeholder="e.g. Chicken Biryani"
            className={inputClass}
          />
          {itemErrors.name && (
            <p id="menu-item-name-error" role="alert" className={errorTextClass}>
              {itemErrors.name}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="menu-item-description" className={labelClass}>
            Description <span className="font-normal text-brand-ink-subtle">(optional)</span>
          </label>
          <textarea
            id="menu-item-description"
            rows={2}
            maxLength={MENU_LIMITS.itemDescription}
            value={itemForm.description}
            onChange={(e) => patchItemForm({ description: e.target.value })}
            placeholder="Ingredients, spice level, what it comes with..."
            className={inputClass}
          />
          {itemErrors.description && (
            <p role="alert" className={errorTextClass}>
              {itemErrors.description}
            </p>
          )}
        </div>

        <fieldset>
          <legend className={labelClass}>Price</legend>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="How is this item priced?">
            {(
              [
                ["single", "One price"],
                ["sizes", "Sizes"],
              ] as const
            ).map(([mode, label]) => {
              const on = itemForm.priceMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => switchPriceMode(mode)}
                  className={
                    on
                      ? "min-h-[44px] rounded-brand-pill bg-brand-ink px-4 text-sm font-medium text-brand-bg"
                      : "min-h-[44px] rounded-brand-pill bg-brand-chip px-4 text-sm font-medium text-brand-chip-ink transition hover:bg-brand-chip/80"
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>

          {itemForm.priceMode === "single" ? (
            <div className="mt-3">
              <label htmlFor="menu-item-price" className="text-xs font-medium text-brand-ink-muted">
                Price
              </label>
              <input
                id="menu-item-price"
                type="text"
                required
                aria-required="true"
                aria-invalid={itemErrors.price ? true : undefined}
                aria-describedby={itemErrors.price ? "menu-item-price-error" : undefined}
                maxLength={MENU_LIMITS.price}
                value={itemForm.price}
                onChange={(e) => patchItemForm({ price: e.target.value })}
                placeholder="e.g. $12, 12 / 18, Market price"
                className={inputClass}
              />
              {itemErrors.price && (
                <p id="menu-item-price-error" role="alert" className={errorTextClass}>
                  {itemErrors.price}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {itemForm.sizes.map((row, index) => {
                const err = rowErrors[index];
                return (
                  <div
                    key={index}
                    className="rounded-brand-control border border-brand-border bg-white p-3"
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor={`menu-item-size-${index}-label`}
                          className="text-xs font-medium text-brand-ink-muted"
                        >
                          Size {index + 1} name
                        </label>
                        <input
                          id={`menu-item-size-${index}-label`}
                          type="text"
                          aria-invalid={err?.label ? true : undefined}
                          maxLength={MENU_LIMITS.sizeLabel}
                          value={row.label}
                          onChange={(e) => setSizeField(index, "label", e.target.value)}
                          placeholder="e.g. Personal, Double, Family Pack"
                          className={inputClass}
                        />
                        {err?.label && (
                          <p role="alert" className={errorTextClass}>
                            {err.label}
                          </p>
                        )}
                      </div>
                      <div>
                        <label
                          htmlFor={`menu-item-size-${index}-price`}
                          className="text-xs font-medium text-brand-ink-muted"
                        >
                          Size {index + 1} price
                        </label>
                        <input
                          id={`menu-item-size-${index}-price`}
                          type="text"
                          aria-invalid={err?.price ? true : undefined}
                          maxLength={MENU_LIMITS.price}
                          value={row.price}
                          onChange={(e) => setSizeField(index, "price", e.target.value)}
                          placeholder="e.g. $10"
                          className={inputClass}
                        />
                        {err?.price && (
                          <p role="alert" className={errorTextClass}>
                            {err.price}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        aria-label={`Move size ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => patchItemForm({ sizes: moveRow(itemForm.sizes, index, -1) })}
                        className={iconButton}
                      >
                        <ChevronDownIcon className="h-4 w-4 rotate-180" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move size ${index + 1} down`}
                        disabled={index === itemForm.sizes.length - 1}
                        onClick={() => patchItemForm({ sizes: moveRow(itemForm.sizes, index, 1) })}
                        className={iconButton}
                      >
                        <ChevronDownIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          patchItemForm({ sizes: itemForm.sizes.filter((_, i) => i !== index) })
                        }
                        className={dangerButton}
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                        Remove size
                      </button>
                    </div>
                  </div>
                );
              })}
              {itemErrors.sizes && (
                <p role="alert" className={errorTextClass}>
                  {itemErrors.sizes}
                </p>
              )}
              <button
                id="menu-item-add-size"
                type="button"
                disabled={itemForm.sizes.length >= MENU_LIMITS.maxSizes}
                onClick={() =>
                  patchItemForm({ sizes: [...itemForm.sizes, { label: "", price: "" }] })
                }
                className={`${rowButton} self-start`}
              >
                <PlusIcon className="h-3.5 w-3.5" />
                Add a size
                {itemForm.sizes.length >= MENU_LIMITS.maxSizes ? ` (max ${MENU_LIMITS.maxSizes})` : ""}
              </button>
            </div>
          )}
        </fieldset>

        <div>
          <label htmlFor="menu-item-group" className={labelClass}>
            Group
          </label>
          <select
            id="menu-item-group"
            value={itemForm.section_id ?? ""}
            onChange={(e) =>
              patchItemForm({ section_id: e.target.value === "" ? null : Number(e.target.value) })
            }
            className={`${inputClass} min-h-[44px]`}
          >
            <option value="">No group</option>
            {menu.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {photosOn && (
          <div>
            <p className={labelClass}>
              Photo <span className="font-normal text-brand-ink-subtle">(optional, small)</span>
            </p>
            {editingItem ? (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {editingItem.photo_thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote CloudFront URL
                  <img
                    src={editingItem.photo_thumbnail_url}
                    alt={`Photo of ${editingItem.name}`}
                    className="h-20 w-20 rounded-brand-control border border-brand-border object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-brand-control border border-dashed border-brand-border text-brand-ink-subtle">
                    <ImageIcon className="h-6 w-6" />
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="menu-item-photo"
                    className="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-brand-control border border-brand-border bg-white px-4 text-sm font-semibold text-brand-ink transition hover:border-brand-ink-subtle"
                  >
                    <PlusIcon className="h-4 w-4" />
                    {photoBusy
                      ? "Working..."
                      : editingItem.photo_url
                        ? "Replace photo"
                        : "Upload photo"}
                  </label>
                  <input
                    id="menu-item-photo"
                    ref={photoInputRef}
                    type="file"
                    accept={MENU_PHOTO_TYPES.join(",")}
                    disabled={photoBusy}
                    onChange={(e) => handlePhotoFile(editingItem, e)}
                    className="sr-only"
                  />
                  {editingItem.photo_url && (
                    <button
                      type="button"
                      disabled={photoBusy}
                      onClick={() => handleRemovePhoto(editingItem)}
                      className={dangerButton}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                      Remove photo
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-1 text-xs text-brand-ink-subtle">
                Save the item first, then edit it to add a photo.
              </p>
            )}
            <p className="mt-1 text-xs text-brand-ink-subtle">JPEG or PNG, up to 2 MB.</p>
            {photoError && (
              <p role="alert" className={errorTextClass}>
                {photoError}
              </p>
            )}
          </div>
        )}

        {itemFormError && (
          <p className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
            {itemFormError}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={itemSaving} className={primaryButton}>
            {itemSaving ? "Saving..." : itemEditing === "new" ? "Add item" : "Save changes"}
          </button>
          <button type="button" onClick={closeItemForm} disabled={itemSaving} className={secondaryButton}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  // ---------------------------------------------------------------------
  // Lists
  // ---------------------------------------------------------------------

  function renderItemRows(sectionId: number | null, items: MenuItem[], groupHidden = false) {
    const reorderBusy = busyKey === `items-${sectionId ?? "none"}`;
    return (
      <ul className="divide-y divide-brand-border rounded-brand-control border border-brand-border empty:hidden">
        {items.map((item, index) => {
          if (itemEditing === item.id) {
            return (
              <li key={item.id} className="p-3">
                {renderItemForm()}
              </li>
            );
          }
          const busy = busyKey === `item-${item.id}`;
          const confirming = confirmItemId === item.id;
          return (
            <li key={item.id} className="flex flex-col gap-3 p-4">
              <div className="flex min-w-0 gap-3">
                {photosOn && item.photo_thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element -- remote CloudFront URL
                  <img
                    src={item.photo_thumbnail_url}
                    alt={`Photo of ${item.name}`}
                    className="h-14 w-14 shrink-0 rounded-brand-control border border-brand-border object-cover"
                  />
                )}
                <div className={item.is_hidden || groupHidden ? "min-w-0 opacity-70" : "min-w-0"}>
                  {(item.is_hidden || groupHidden) && (
                    <div className="mb-1 flex flex-wrap gap-1.5">
                      {item.is_hidden && <HiddenChip label="Hidden from diners" />}
                      {groupHidden && !item.is_hidden && <HiddenChip label="Hidden with its group" />}
                    </div>
                  )}
                  <p className="break-words text-sm font-semibold text-brand-ink">{item.name}</p>
                  {item.description && (
                    <p className="mt-0.5 whitespace-pre-line break-words text-sm text-brand-ink-muted">
                      {item.description}
                    </p>
                  )}
                  <p className="mt-1 break-words text-xs font-medium text-brand-ink-subtle">
                    {formatItemPrice(item)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-label={`Move ${item.name} up`}
                  disabled={index === 0 || reorderBusy || busy}
                  onClick={() => moveItem(sectionId, items, index, -1)}
                  className={iconButton}
                >
                  <ChevronDownIcon className="h-4 w-4 rotate-180" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${item.name} down`}
                  disabled={index === items.length - 1 || reorderBusy || busy}
                  onClick={() => moveItem(sectionId, items, index, 1)}
                  className={iconButton}
                >
                  <ChevronDownIcon className="h-4 w-4" />
                </button>
                <VisibilityToggleButton
                  hidden={item.is_hidden}
                  name={item.name}
                  onToggle={() => toggleItemHidden(item)}
                  busy={busyKey === `vis-item-${item.id}`}
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => openEditItem(item)}
                  disabled={busy || anyFormOpen}
                  className={rowButton}
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(item)}
                  disabled={busy}
                  className={confirming ? dangerSolidButton : dangerButton}
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                  {busy ? "Deleting..." : confirming ? "Confirm — delete item" : "Delete"}
                </button>
                {confirming && (
                  <button
                    type="button"
                    onClick={() => setConfirmItemId(null)}
                    className="min-h-[44px] px-2 text-xs font-medium text-brand-ink-subtle underline"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  function renderSection(section: MenuSectionWithItems, index: number) {
    if (sectionEditing === section.id) {
      return <div key={section.id}>{renderSectionForm()}</div>;
    }
    const busy = busyKey === `section-${section.id}`;
    const confirming = confirmSectionId === section.id;
    const count = section.items.length;
    return (
      <div key={section.id} className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 rounded-brand-control bg-brand-bg p-4">
          <div className="min-w-0">
            {section.is_hidden && (
              <div className="mb-1">
                <HiddenChip label="Group hidden from diners" />
              </div>
            )}
            <h3 className="break-words font-display text-lg font-bold text-brand-ink">
              {section.name}
            </h3>
            {section.description && (
              <p className="mt-0.5 whitespace-pre-line break-words text-sm text-brand-ink-muted">
                {section.description}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-label={`Move group ${section.name} up`}
              disabled={index === 0 || busyKey === "sections" || busy}
              onClick={() => moveSection(index, -1)}
              className={iconButton}
            >
              <ChevronDownIcon className="h-4 w-4 rotate-180" />
            </button>
            <button
              type="button"
              aria-label={`Move group ${section.name} down`}
              disabled={index === menu.sections.length - 1 || busyKey === "sections" || busy}
              onClick={() => moveSection(index, 1)}
              className={iconButton}
            >
              <ChevronDownIcon className="h-4 w-4" />
            </button>
            <VisibilityToggleButton
              hidden={section.is_hidden}
              name={`group ${section.name}`}
              onToggle={() => toggleSectionHidden(section)}
              busy={busyKey === `vis-section-${section.id}`}
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => openEditSection(section)}
              disabled={busy || anyFormOpen}
              className={rowButton}
            >
              <PencilIcon className="h-3.5 w-3.5" />
              Edit group
            </button>
            <button
              type="button"
              onClick={() => openNewItem(section.id)}
              disabled={busy || anyFormOpen}
              className={rowButton}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Add item
            </button>
            {!confirming && (
              <button
                type="button"
                onClick={() => setConfirmSectionId(section.id)}
                disabled={busy}
                className={dangerButton}
              >
                <TrashIcon className="h-3.5 w-3.5" />
                Delete group
              </button>
            )}
          </div>
          {confirming && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-brand-control border border-brand-closed bg-white p-3"
            >
              <p className="text-sm text-brand-ink">
                Delete the group &ldquo;{section.name}&rdquo;?
                {count > 0
                  ? ` It has ${count} item${count === 1 ? "" : "s"}. You can keep them (they move to “Items without a group”) or delete them too.`
                  : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removeSection(section, false)}
                  className={dangerSolidButton}
                >
                  {busy
                    ? "Deleting..."
                    : count > 0
                      ? "Delete group, keep items"
                      : "Confirm — delete group"}
                </button>
                {count > 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removeSection(section, true)}
                    className={dangerButton}
                  >
                    Delete group and its {count} item{count === 1 ? "" : "s"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmSectionId(null)}
                  className="min-h-[44px] px-2 text-xs font-medium text-brand-ink-subtle underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        {count > 0 ? (
          renderItemRows(section.id, section.items, section.is_hidden)
        ) : (
          <p className="text-sm text-brand-ink-subtle">No items in this group yet.</p>
        )}
      </div>
    );
  }

  return (
    <section
      id="menu"
      aria-labelledby="menu-heading"
      className={`${SECTION_ANCHOR_CLASS} rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="menu-heading"
          className="flex items-center gap-2 font-display text-xl font-bold text-brand-ink"
        >
          <MenuBookIcon className="h-5 w-5 text-brand-ink-subtle" />
          Menu
        </h2>
        {!anyFormOpen && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={openNewSection} className={secondaryButton}>
              <PlusIcon className="h-4 w-4" />
              <span className="ml-2">Add a group</span>
            </button>
            <button type="button" onClick={() => openNewItem(null)} className={primaryButton}>
              <PlusIcon className="h-4 w-4" />
              Add an item
            </button>
          </div>
        )}
      </div>
      <p className="mt-1 text-sm text-brand-ink-muted">
        Free for every listing and visible to everyone. Group items (Appetizers, Main Course…) or
        leave them ungrouped; give each item a price, or several sizes with their own prices. Use
        Hide to take a dish, a group or the whole menu off your listing without deleting it.
      </p>

      {/* Whole-menu switch. Hidden state is loud so an owner never wonders why
          nothing shows publicly; nothing is deleted either way. */}
      {(!isEmpty || menu.menu_hidden) && (
        <SectionVisibilityBar
          hidden={menu.menu_hidden}
          visibleText={
            hiddenSummary(countHidden(menu))
              ? `Your menu is visible to diners (except ${hiddenSummary(countHidden(menu))}).`
              : "Your menu is visible to diners."
          }
          hiddenText="Your whole menu is hidden from diners. Nothing is deleted — everything below is kept."
          hideLabel="Hide entire menu"
          showLabel="Show menu"
          onToggle={toggleMenuHidden}
          busy={busyKey === "vis-menu"}
        />
      )}

      {/* New group / new item forms always open here at the top (a stable
          spot, so changing the item's Group dropdown never moves the form
          under the owner); editing an existing group/item happens in place. */}
      {sectionEditing === "new" && <div className="mt-4">{renderSectionForm()}</div>}
      {itemEditing === "new" && <div className="mt-4">{renderItemForm()}</div>}

      {isEmpty && !anyFormOpen && (
        <p className="mt-4 rounded-brand-control border border-dashed border-brand-border px-4 py-6 text-center text-sm text-brand-ink-subtle">
          Your menu is empty, so nothing shows on your listing yet. Add a group such as
          &ldquo;Appetizers&rdquo; or add items directly.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-6">
        {menu.ungrouped_items.length > 0 && (
          <div className="flex flex-col gap-3">
            {menu.sections.length > 0 && (
              <h3 className="font-display text-lg font-bold text-brand-ink">Items without a group</h3>
            )}
            {renderItemRows(null, menu.ungrouped_items)}
          </div>
        )}
        {menu.sections.map((section, index) => renderSection(section, index))}
      </div>

      {listError && (
        <p
          role="alert"
          className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {listError}
        </p>
      )}
    </section>
  );
}
