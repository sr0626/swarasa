"use client";

// Browser half of the form guard (docs/API_CONTRACTS.md "Form guard"):
//
//  * the signed token is fetched LAZILY — the first time the visitor focuses
//    or taps inside the form (`formProps`), or at submit time if that never
//    happened. Merely loading a page therefore costs the backend nothing
//    (a crawler or drive-by never requests a token), and the page can stay
//    static;
//  * `prepare()` returns `{ token, trap }` for the server action, silently
//    waiting out the backend's minimum time-to-submit when a fast human (or a
//    password manager's autofill + Enter) beats it — the user just sees the
//    usual "Sending…" a moment longer instead of an error;
//  * a token is single use: `refresh()` drops it after every attempt (success
//    or failure) and the next focus / submit fetches a new one;
//  * if the token fetch fails the form still renders and submits; the backend
//    (when enforcing) answers its generic "please try again".
//
// Pure decisions live in guardLogic.ts (unit-tested); this file is only the
// React/timer glue.
import { useCallback, useRef, useState } from "react";
import { verifyFormGateAction, type GateResult } from "@/lib/actions/formGuard";
import { requestFormToken } from "@/lib/api/formToken";
import {
  msUntilSubmittable,
  tokenIsStale,
  type FormName,
  type GuardPayload,
} from "./guardLogic";

export interface FormGuard {
  /** Current token, for the hidden input (null until first interaction). */
  token: string | null;
  /** Honeypot value (humans never touch it). */
  trap: string;
  setTrap: (value: string) => void;
  /** Spread onto the <form>: fetches the token on first focus / tap. */
  formProps: { onFocusCapture: () => void; onPointerDownCapture: () => void };
  /** Resolves with the payload for the server action (waits out the minimum age). */
  prepare: () => Promise<GuardPayload>;
  /** Drop the consumed token; the next interaction fetches a fresh one. */
  refresh: () => void;
  /** Cognito flows: prepare → verify on the server → refresh. `ok` = go on to Cognito. */
  gate: () => Promise<GateResult>;
}

interface TokenState {
  token: string | null;
  receivedAt: number;
  minSeconds: number;
}

const EMPTY: TokenState = { token: null, receivedAt: 0, minSeconds: 0 };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useFormGuard(form: FormName): FormGuard {
  const state = useRef<TokenState>(EMPTY);
  const inflight = useRef<Promise<void> | null>(null);
  const trapRef = useRef("");
  const [token, setToken] = useState<string | null>(null);
  const [trap, setTrapState] = useState("");

  const load = useCallback((): Promise<void> => {
    if (inflight.current) return inflight.current;
    const pending = requestFormToken(form)
      .then((issued) => {
        if (issued) {
          state.current = {
            token: issued.token,
            receivedAt: Date.now(),
            minSeconds: issued.minSeconds,
          };
          setToken(issued.token);
        } else {
          state.current = EMPTY;
          setToken(null);
        }
      })
      .finally(() => {
        inflight.current = null;
      });
    inflight.current = pending;
    return pending;
  }, [form]);

  const touch = useCallback(() => {
    if (!state.current.token && !inflight.current) void load();
  }, [load]);

  const refresh = useCallback(() => {
    state.current = EMPTY;
    setToken(null);
  }, []);

  const prepare = useCallback(async (): Promise<GuardPayload> => {
    if (!state.current.token || tokenIsStale(state.current.receivedAt, Date.now())) {
      await load();
    }
    const current = state.current;
    if (current.token) {
      const wait = msUntilSubmittable(current.receivedAt, Date.now(), current.minSeconds);
      if (wait > 0) await sleep(wait);
    }
    return { token: current.token, trap: trapRef.current };
  }, [load]);

  const gate = useCallback(async (): Promise<GateResult> => {
    const payload = await prepare();
    const result = await verifyFormGateAction(form, payload);
    refresh();
    return result;
  }, [form, prepare, refresh]);

  const setTrap = useCallback((value: string) => {
    trapRef.current = value;
    setTrapState(value);
  }, []);

  return {
    token,
    trap,
    setTrap,
    formProps: { onFocusCapture: touch, onPointerDownCapture: touch },
    prepare,
    refresh,
    gate,
  };
}
