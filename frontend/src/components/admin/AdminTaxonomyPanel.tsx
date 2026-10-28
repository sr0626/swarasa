"use client";

// Admin taxonomy manager (docs/API_CONTRACTS.md "Admin taxonomy management"):
// add a tag, rename it, deactivate / reactivate it. Tags are grouped by kind
// with usage counts. There is deliberately no delete. Deactivating asks for
// confirmation in an alertdialog (nothing is removed from locations; the tag
// just stops being offered / shown publicly). Pure logic lives in
// lib/adminTaxonomyView.ts. Mobile-first: 44px targets, no horizontal scroll.
import { useEffect, useRef, useState } from "react";
import {
  createTagAction,
  renameTagAction,
  setTagActiveAction,
  type TaxonomyActionResult,
} from "@/app/admin/taxonomy/actions";
import LocalDateTime from "@/components/ui/LocalDateTime";
import {
  DISPLAY_NAME_MAX,
  KIND_LABEL,
  KIND_ORDER,
  deactivateConfirmText,
  filterTags,
  groupAdminTags,
  isDuplicateName,
  slugPreview,
  summarize,
  upsertTag,
  usageLabel,
  validateDisplayName,
  type StateFilter,
} from "@/lib/adminTaxonomyView";
import type { AdminTag } from "@/types/adminTaxonomy";
import type { CuisineCategory } from "@/types/cuisine";

const INPUT =
  "min-h-[44px] w-full rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent";
const BTN_PRIMARY =
  "flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const BTN_SECONDARY =
  "flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border bg-white px-4 text-sm font-semibold text-brand-ink-muted transition hover:bg-brand-chip focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-not-allowed disabled:opacity-60";

export default function AdminTaxonomyPanel({ initialTags }: { initialTags: AdminTag[] }) {
  const [tags, setTags] = useState<AdminTag[]>(initialTags);
  const [state, setState] = useState<StateFilter>("all");
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState<AdminTag | null>(null);

  const counts = summarize(tags);
  const groups = groupAdminTags(filterTags(tags, state, query));

  function handleSaved(tag: AdminTag) {
    setTags((prev) => upsertTag(prev, tag));
  }

  return (
    <div className="flex flex-col gap-6">
      <AddTagForm tags={tags} onCreated={handleSaved} />

      <section aria-labelledby="tags-list-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="tag-search" className="text-sm font-semibold text-brand-ink">
              Search tags
            </label>
            <input
              id="tag-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or slug"
              className={`mt-1 ${INPUT}`}
            />
          </div>
          <div className="sm:w-48">
            <label htmlFor="tag-state" className="text-sm font-semibold text-brand-ink">
              Show
            </label>
            <select
              id="tag-state"
              value={state}
              onChange={(e) => setState(e.target.value as StateFilter)}
              className={`mt-1 ${INPUT}`}
            >
              <option value="all">All tags</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </div>
        </div>

        <h2 id="tags-list-heading" className="sr-only">
          Tags
        </h2>
        <p role="status" className="text-sm text-brand-ink-subtle">
          {counts.total} tags · {counts.active} active · {counts.inactive} inactive
        </p>

        {groups.length === 0 ? (
          <div className="rounded-brand-card border border-dashed border-brand-border bg-white px-6 py-12 text-center">
            <p className="font-display text-base font-semibold text-brand-ink">No tags</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-brand-ink-muted">
              No tags match this view.
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <section
              key={group.category}
              aria-labelledby={`kind-${group.category}`}
              className="rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card sm:p-5"
            >
              <h3
                id={`kind-${group.category}`}
                className="font-display text-lg font-bold text-brand-ink"
              >
                {group.label}{" "}
                <span className="text-sm font-normal text-brand-ink-subtle">
                  ({group.tags.length})
                </span>
              </h3>
              <ul className="mt-3 divide-y divide-brand-border">
                {group.tags.map((tag) => (
                  <li key={tag.id}>
                    <TagRow
                      tag={tag}
                      allTags={tags}
                      onSaved={handleSaved}
                      onAskDeactivate={() => setConfirming(tag)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </section>

      {confirming && (
        <DeactivateDialog
          tag={confirming}
          onCancel={() => setConfirming(null)}
          onDone={(tag) => {
            handleSaved(tag);
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}

function AddTagForm({
  tags,
  onCreated,
}: {
  tags: AdminTag[];
  onCreated: (tag: AdminTag) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<CuisineCategory>("type");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setAdded(null);
    const invalid = validateDisplayName(name);
    if (invalid) return setError(invalid);
    if (isDuplicateName(tags, category, name)) {
      return setError("A tag with that name already exists.");
    }
    setPending(true);
    try {
      const result = await createTagAction(name, category);
      if (result.ok) {
        onCreated(result.tag);
        setAdded(result.tag.display_name);
        setName("");
      } else {
        setError(result.error);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const slug = slugPreview(name);

  return (
    <form
      onSubmit={submit}
      aria-labelledby="add-tag-heading"
      className="rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card sm:p-5"
    >
      <h2 id="add-tag-heading" className="font-display text-lg font-bold text-brand-ink">
        Add a tag
      </h2>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="new-tag-name" className="text-sm font-semibold text-brand-ink">
            Name
          </label>
          <input
            id="new-tag-name"
            value={name}
            maxLength={DISPLAY_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            placeholder="e.g. Pop-up Kitchen"
            className={`mt-1 ${INPUT}`}
          />
        </div>
        <div className="sm:w-56">
          <label htmlFor="new-tag-kind" className="text-sm font-semibold text-brand-ink">
            Kind
          </label>
          <select
            id="new-tag-kind"
            value={category}
            onChange={(e) => setCategory(e.target.value as CuisineCategory)}
            disabled={pending}
            className={`mt-1 ${INPUT}`}
          >
            {KIND_ORDER.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={pending || !name.trim()} className={`${BTN_PRIMARY} sm:w-auto`}>
          {pending ? "Adding..." : "Add tag"}
        </button>
      </div>
      {slug && (
        <p className="mt-2 break-all text-xs text-brand-ink-subtle">
          Slug (cannot be changed later): <code>{slug}</code>
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {error}
        </p>
      )}
      {added && !error && (
        <p
          role="status"
          className="mt-3 rounded-brand-control bg-brand-success-bg px-3 py-2.5 text-sm text-brand-success"
        >
          Added &ldquo;{added}&rdquo;.
        </p>
      )}
    </form>
  );
}

function TagRow({
  tag,
  allTags,
  onSaved,
  onAskDeactivate,
}: {
  tag: AdminTag;
  allTags: AdminTag[];
  onSaved: (tag: AdminTag) => void;
  onAskDeactivate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tag.display_name);
  const [pending, setPending] = useState<"rename" | "reactivate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "rename" | "reactivate", fn: () => Promise<TaxonomyActionResult>) {
    setError(null);
    setPending(kind);
    try {
      const result = await fn();
      if (result.ok) {
        onSaved(result.tag);
        setEditing(false);
      } else {
        setError(result.error);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(null);
    }
  }

  function saveRename(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const invalid = validateDisplayName(draft);
    if (invalid) return setError(invalid);
    if (isDuplicateName(allTags, tag.category, draft, tag.id)) {
      return setError("A tag with that name already exists.");
    }
    void run("rename", () => renameTagAction(tag.id, draft));
  }

  const inputId = `rename-${tag.id}`;

  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {editing ? (
          <form onSubmit={saveRename} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div>
              <label htmlFor={inputId} className="text-xs font-semibold text-brand-ink-subtle">
                New name for {tag.display_name}
              </label>
              <input
                id={inputId}
                value={draft}
                maxLength={DISPLAY_NAME_MAX}
                onChange={(e) => setDraft(e.target.value)}
                disabled={pending !== null}
                autoFocus
                className={`mt-1 sm:w-64 ${INPUT}`}
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={pending !== null} className={BTN_PRIMARY}>
                {pending === "rename" ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => {
                  setEditing(false);
                  setDraft(tag.display_name);
                  setError(null);
                }}
                className={BTN_SECONDARY}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-2 break-words font-semibold text-brand-ink">
              {tag.display_name}
              <span
                className={`inline-flex items-center rounded-brand-pill px-2.5 py-1 text-xs font-semibold ${
                  tag.is_active
                    ? "bg-brand-success-bg text-brand-success"
                    : "bg-brand-chip text-brand-chip-ink"
                }`}
              >
                {tag.is_active ? "Active" : "Inactive"}
              </span>
            </p>
            <p className="mt-0.5 break-all text-xs text-brand-ink-subtle">
              <code>{tag.name}</code> · {usageLabel(tag.usage_count)} · updated{" "}
              <LocalDateTime value={tag.updated_at} fallback="unknown" />
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-brand-closed">
            {error}
          </p>
        )}
      </div>

      {!editing && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setDraft(tag.display_name);
              setEditing(true);
              setError(null);
            }}
            aria-label={`Rename ${tag.display_name}`}
            className={BTN_SECONDARY}
          >
            Rename
          </button>
          {tag.is_active ? (
            <button
              type="button"
              onClick={onAskDeactivate}
              aria-label={`Deactivate ${tag.display_name}`}
              className={BTN_SECONDARY}
            >
              Deactivate
            </button>
          ) : (
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void run("reactivate", () => setTagActiveAction(tag.id, true))}
              aria-label={`Reactivate ${tag.display_name}`}
              className={BTN_SECONDARY}
            >
              {pending === "reactivate" ? "Reactivating..." : "Reactivate"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DeactivateDialog({
  tag,
  onCancel,
  onDone,
}: {
  tag: AdminTag;
  onCancel: () => void;
  onDone: (tag: AdminTag) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the safe option on open; Escape cancels.
  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function confirm() {
    setError(null);
    setPending(true);
    try {
      const result = await setTagActiveAction(tag.id, false);
      if (result.ok) onDone(result.tag);
      else setError(result.error);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="deactivate-title"
        aria-describedby="deactivate-body"
        className="w-full max-w-md rounded-brand-card bg-white p-5 shadow-brand-card"
      >
        <h2 id="deactivate-title" className="font-display text-lg font-bold text-brand-ink">
          Deactivate tag?
        </h2>
        <p id="deactivate-body" className="mt-2 text-sm text-brand-ink-muted">
          {deactivateConfirmText(tag)}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-brand-closed">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            disabled={pending}
            onClick={onCancel}
            className={BTN_SECONDARY}
          >
            Cancel
          </button>
          <button type="button" disabled={pending} onClick={confirm} className={BTN_PRIMARY}>
            {pending ? "Deactivating..." : "Deactivate"}
          </button>
        </div>
      </div>
    </div>
  );
}
