import type { Config } from "tailwindcss";

/**
 * Base Tailwind config.
 *
 * Visual direction: "Spice Market" (picked 2026-09-13 from a 12-option
 * design canvas — see docs/homepage-direction-spice-market). Every color,
 * font, radius, and shadow value that direction defines lives here as a
 * NAMED TOKEN under `theme.extend`, not as a literal hex/px value scattered
 * across component files.
 *
 * Naming scheme (keep it semantic, not decorative — a rebrand should only
 * ever touch the values below, never a component file):
 *   - colors.brand.*     — semantic color roles: `bg`, `ink` (+ `-muted`/
 *     `-subtle` steps), `placeholder`, `accent` (+ `-hover`), `accent-warm`,
 *     `accent-gold`, `chip` (+ `-ink`), `success` (+ `-bg`), `closed`
 *     (+ `-bg`), `border`. Components use e.g. `bg-brand-accent`,
 *     `text-brand-ink`, `border-brand-border` — never a raw hex code.
 *   - fontFamily.display / .body — the two Google Fonts for this direction
 *     (Space Grotesk / Manrope), loaded via `next/font/google` in
 *     `src/app/layout.tsx` as CSS custom properties (`--font-display`,
 *     `--font-body`) and referenced here. Components use `font-display` /
 *     `font-body` — never a literal font-family string.
 *   - borderRadius.brand-* / boxShadow.brand-* — the pill/card/control
 *     radii and card elevation this direction uses. Components use
 *     `rounded-brand-pill`, `shadow-brand-card`, etc.
 *
 * To rebrand later: edit the values in this file (and the font imports in
 * `layout.tsx` if the typefaces change) — zero component files should need
 * to change.
 */
const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: "#FBF5EC",
          ink: "#241812",
          "ink-muted": "#5A4A3E",
          "ink-subtle": "#8A7A6E",
          placeholder: "#A79684",
          accent: "#C0392B",
          "accent-hover": "#8E2A1F",
          "accent-warm": "#E4622C",
          "accent-gold": "#F0A93E",
          chip: "#F0DEC4",
          "chip-ink": "#8A4A16",
          success: "#2F7A4A",
          "success-bg": "#E4F2E7",
          closed: "#A34632",
          "closed-bg": "#F5E4DE",
          border: "#EDE2D2",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        "brand-pill": "999px",
        "brand-card": "20px",
        "brand-control": "12px",
      },
      // A few soft rings radiating from the "Activate listing" button the moment
      // a listing's checklist is complete (ActivateListingButton `emphasize`).
      // Finite (4 pulses), and only under `motion-safe:`.
      keyframes: {
        "go-live-glow": {
          "0%": { boxShadow: "0 0 0 0 rgba(192, 57, 43, 0.5)" },
          "100%": { boxShadow: "0 0 0 12px rgba(192, 57, 43, 0)" },
        },
      },
      animation: {
        "go-live-glow": "go-live-glow 1.4s ease-out 4",
      },
      boxShadow: {
        "brand-card": "0 2px 8px 0 rgba(36, 24, 18, 0.08)",
        "brand-card-hover": "0 10px 24px 0 rgba(36, 24, 18, 0.14)",
        "brand-control": "0 1px 2px 0 rgba(36, 24, 18, 0.06)",
      },
      backgroundImage: {
        "brand-warm-gradient":
          "linear-gradient(135deg, #C0392B 0%, #E4622C 55%, #F0A93E 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
