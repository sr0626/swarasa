"use client";

// Dismissible "add your city and ZIP" nudge shown on the home/search pages to
// a signed-in diner with no saved location. Dismissal is per browser session
// only (sessionStorage) -- it comes back next visit until the location is
// saved, so it is dismissible but never a way to skip providing the data.
// Browsing is never blocked either way.
import Link from "next/link";
import { useEffect, useState } from "react";

const DISMISS_KEY = "swarasa.locationPromptDismissed";

export default function LocationPromptBannerView() {
  // Start hidden to avoid a flash/hydration mismatch; reveal after reading storage.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(window.sessionStorage.getItem(DISMISS_KEY) !== "1");
    } catch {
      setVisible(true); // storage blocked -- just show it
    }
  }, []);

  if (!visible) return null;

  function dismiss() {
    setVisible(false);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore -- it simply returns on the next page load
    }
  }

  return (
    <div
      role="region"
      aria-label="Add your location"
      className="border-b border-brand-border bg-brand-bg"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-sm text-brand-ink">
          <span className="font-semibold">
            Add your city and ZIP to see nearby restaurants and deals.
          </span>
        </p>
        <div className="flex items-center gap-2">
          <Link
            href="/account#location"
            className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover"
          >
            Add location
          </Link>
          <button
            type="button"
            onClick={dismiss}
            className="flex min-h-[44px] items-center justify-center rounded-brand-control px-4 text-sm font-medium text-brand-ink-muted transition hover:text-brand-ink"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
