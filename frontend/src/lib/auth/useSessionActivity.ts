"use client";

// While a signed-in visitor is using the site, re-extend the session cookie
// (PUT /api/auth/session). Without "keep me signed in" the cookie lives 15
// minutes; before this, it ran out even in the middle of editing. The server
// reads the httpOnly cookie itself and can only extend a session that is still
// valid, never revive one. It works after a page reload too, up to the
// token's own expiry.
import { useEffect } from "react";
import { shouldTouch } from "./activity";
import { noteActivity } from "./activityStore";

const EVENTS = ["pointerdown", "keydown", "scroll"] as const;

let lastTouchAt: number | null = null;

export function useSessionActivity(): void {
  useEffect(() => {
    function onActivity() {
      noteActivity();
      const now = Date.now();
      if (!shouldTouch(lastTouchAt, now)) return;
      lastTouchAt = now;
      // Best effort: on failure the next interval tries again.
      void fetch("/api/auth/session", { method: "PUT" }).catch(() => {});
    }
    function onVisible() {
      if (document.visibilityState === "visible") onActivity();
    }
    onActivity(); // opening or navigating to a page counts as use
    for (const name of EVENTS) window.addEventListener(name, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      for (const name of EVENTS) window.removeEventListener(name, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
