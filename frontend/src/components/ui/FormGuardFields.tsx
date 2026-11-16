"use client";

// Hidden fields of the form guard (lib/formGuard/useFormGuard.ts):
//   * a honeypot text input humans never see or reach — off-screen (not
//     display:none, which simple bots skip), aria-hidden, tabIndex -1,
//     autocomplete off, and an unremarkable name (guardLogic TRAP_FIELD_NAME,
//     nothing a browser or password manager autofills);
//   * a hidden input carrying the current form token.
//
// Absolutely positioned, so it causes no layout shift and cannot create
// horizontal scroll. Render it as the LAST child of the <form>: some password
// managers treat the first text input before a password field as the
// username, and this must never be mistaken for one. The `data-*` attributes
// ask the common managers to ignore it as well.
import { useId } from "react";
import type { FormGuard } from "@/lib/formGuard/useFormGuard";
import { TRAP_FIELD_NAME } from "@/lib/formGuard/guardLogic";

export function FormGuardFields({ guard }: { guard: FormGuard }) {
  const trapId = useId();
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-[9999px] top-auto h-px w-px overflow-hidden"
      >
        <label htmlFor={trapId}>Leave this field empty</label>
        <input
          id={trapId}
          type="text"
          name={TRAP_FIELD_NAME}
          tabIndex={-1}
          autoComplete="off"
          data-lpignore="true"
          data-1p-ignore="true"
          data-bwignore="true"
          data-form-type="other"
          value={guard.trap}
          onChange={(event) => guard.setTrap(event.target.value)}
        />
      </div>
      <input type="hidden" name="form_token" value={guard.token ?? ""} />
    </>
  );
}
