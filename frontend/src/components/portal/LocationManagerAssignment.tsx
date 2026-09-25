"use client";

// Manager assignment — owner-only per docs/API_CONTRACTS.md "POST
// /locations/{id}/managers" ("no admin, no manager path... assigning a
// manager is exclusively an owner action") and the task's own instruction
// for this section. This component is only ever rendered for an owner
// session (see `/portal/locations/[id]/page.tsx`); the server actions it
// calls re-check `role === "owner"` independently too (defense in depth,
// same posture as the admin claims actions).
//
// Paid-tier cap of 2 active managers (docs/DECISIONS.md "Assignable
// location managers capped at 2 per location") is enforced here in the UI
// before submitting, in addition to the API's own 409 `manager_cap_reached`
// — confirmed against backend/app/services/location_manager_service.py's
// `assert_can_add_active_manager`: the cap is paid-tier only, free tier has
// no cap.
import { useState } from "react";
import {
  assignLocationManagerAction,
  removeLocationManagerAction,
} from "@/app/portal/locations/[id]/actions";
import { inputClass } from "@/components/portal/formFields";
import { PlusIcon, TrashIcon, UsersIcon } from "@/components/ui/icons";
import type { LocationManager } from "@/types/location";

const PAID_MANAGER_CAP = 2;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function LocationManagerAssignment({
  locationId,
  isPaid,
  initialManagers,
}: {
  locationId: number;
  isPaid: boolean;
  initialManagers: LocationManager[];
}) {
  const [managers, setManagers] = useState<LocationManager[]>(initialManagers);
  const [email, setEmail] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const activeManagers = managers.filter((m) => m.is_active);
  const atCap = isPaid && activeManagers.length >= PAID_MANAGER_CAP;

  async function handleAssign(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAssignError(null);

    if (atCap) {
      setAssignError(
        `This location already has ${PAID_MANAGER_CAP} active managers — the maximum allowed on the paid tier.`
      );
      return;
    }

    setAssigning(true);
    try {
      const result = await assignLocationManagerAction(locationId, email.trim());
      if (result.ok) {
        setManagers((prev) => [result.data, ...prev]);
        setEmail("");
      } else {
        setAssignError(result.error);
      }
    } finally {
      setAssigning(false);
    }
  }

  async function handleRemove(manager: LocationManager) {
    if (confirmingRemoveId !== manager.id) {
      setConfirmingRemoveId(manager.id);
      return;
    }
    setRemoveError(null);
    setRemovingId(manager.id);
    try {
      const result = await removeLocationManagerAction(locationId, manager.id);
      if (result.ok) {
        setManagers((prev) =>
          prev.map((m) =>
            m.id === manager.id
              ? { ...m, is_active: false, revoked_at: new Date().toISOString() }
              : m
          )
        );
      } else {
        setRemoveError(result.error);
      }
    } finally {
      setRemovingId(null);
      setConfirmingRemoveId(null);
    }
  }

  return (
    <section
      aria-labelledby="managers-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <h2
        id="managers-heading"
        className="flex items-center gap-2 font-display text-xl font-bold text-brand-ink"
      >
        <UsersIcon className="h-5 w-5 text-brand-ink-subtle" />
        Managers
      </h2>
      <p className="mt-1 text-sm text-brand-ink-muted">
        Managers you assign can edit this location&apos;s details, hours, and photos.
        {isPaid && ` Paid-tier locations may have up to ${PAID_MANAGER_CAP} active managers.`}
      </p>

      {managers.length > 0 && (
        <ul className="mt-4 divide-y divide-brand-border rounded-brand-control border border-brand-border">
          {managers.map((manager) => (
            <li key={manager.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0 max-w-full">
                <p className="break-all text-sm font-medium text-brand-ink">
                  {manager.email ?? "Unknown user"}
                </p>
                <p className="text-xs text-brand-ink-subtle">
                  {manager.is_active
                    ? `Assigned ${formatDate(manager.assigned_at)}`
                    : `Removed${manager.revoked_at ? ` ${formatDate(manager.revoked_at)}` : ""}`}
                </p>
              </div>

              {manager.is_active ? (
                <button
                  type="button"
                  onClick={() => handleRemove(manager)}
                  disabled={removingId === manager.id}
                  className={
                    confirmingRemoveId === manager.id
                      ? "flex min-h-[44px] items-center gap-1.5 rounded-brand-control bg-brand-closed px-3 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      : "flex min-h-[44px] items-center gap-1.5 rounded-brand-control border border-brand-closed px-3 text-xs font-semibold text-brand-closed transition hover:bg-brand-closed-bg disabled:cursor-not-allowed disabled:opacity-60"
                  }
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                  {removingId === manager.id
                    ? "Removing..."
                    : confirmingRemoveId === manager.id
                    ? "Confirm remove"
                    : "Remove"}
                </button>
              ) : (
                <span className="rounded-brand-pill bg-brand-bg px-2.5 py-1 text-xs font-semibold text-brand-ink-subtle">
                  Removed
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {removeError && (
        <p className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
          {removeError}
        </p>
      )}

      <form onSubmit={handleAssign} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="manager_email" className="text-sm font-semibold text-brand-ink">
            Assign a manager by email
          </label>
          <input
            id="manager_email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="manager@example.com"
            disabled={atCap}
            className={`${inputClass(false)} disabled:cursor-not-allowed disabled:bg-brand-bg`}
          />
        </div>
        <button
          type="submit"
          disabled={assigning || atCap}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          <PlusIcon className="h-4 w-4" />
          {assigning ? "Assigning..." : "Assign"}
        </button>
      </form>
      {atCap && (
        <p className="mt-2 text-xs text-brand-ink-subtle">
          This location already has {PAID_MANAGER_CAP} active managers — the maximum allowed on
          the paid tier. Remove one before assigning another.
        </p>
      )}
      {assignError && (
        <p className="mt-2 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
          {assignError}
        </p>
      )}
    </section>
  );
}
