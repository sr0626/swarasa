/**
 * Lighthouse CI config for the Phase 1 go/no-go criterion in
 * frontend/CLAUDE.md ("Lighthouse mobile score target: > 85") /
 * docs/PROJECT_PLAN.csv row 54 ("Mobile viewport (375px) / Lighthouse
 * score validation").
 *
 * Run locally via `npm run lighthouse` (see package.json), or in CI via
 * .github/workflows/lighthouse-ci.yml on any PR touching frontend/**.
 *
 * Scope: homepage ("/") and the search results page ("/search") only.
 * The restaurant detail page (/restaurant/[slug]) is deliberately
 * excluded — with no backend deployed and no seeded data, every slug hits
 * the app's error boundary (see tests/e2e/test_mobile_viewport.spec.ts's
 * own comment: "No backend deployed — this renders the error boundary for
 * any slug"). A generic error page isn't a meaningful performance sample
 * and isn't what a Phase 1 go/no-go check is meant to catch. Homepage and
 * search both render their real layout with a graceful empty state when
 * the backend is unreachable (see PopularNearYou.tsx / SearchResults.tsx),
 * so they're representative without needing a live backend or seeded data.
 */
module.exports = {
  ci: {
    collect: {
      url: [
        "http://localhost:4310/",
        "http://localhost:4310/search",
      ],
      startServerCommand: "npm run start -- -p 4310",
      startServerReadyPattern: "Ready",
      startServerReadyTimeout: 60000,
      // 3 runs per URL, assertions applied to the median run — reduces
      // false failures/passes from a single noisy run on a shared CI
      // runner, at the cost of ~3x the Lighthouse run time (build/serve
      // only happen once).
      numberOfRuns: 3,
      settings: {
        // GitHub Actions' ubuntu-latest runner blocks Chrome's own
        // sandbox (unprivileged user namespaces are locked down —
        // Chrome crashes with "No usable sandbox!" / SIGABRT otherwise,
        // confirmed by this exact failure in this workflow's first real
        // CI run). --no-sandbox is the standard, widely-documented
        // workaround for headless Chrome in a container like this one;
        // --disable-dev-shm-usage avoids a second, separate failure mode
        // from /dev/shm being too small in the same environment.
        // --disable-gpu added defensively alongside the other two — a
        // commonly-needed third flag for headless Chrome in the same kind
        // of constrained CI container, even though this run's crash was
        // specifically the sandbox, not GPU init.
        //
        // MUST be a single space-separated STRING, not an array — LHCI's
        // `chromeFlags` setting maps straight onto the `lighthouse` CLI's
        // own `--chrome-flags="..."` option, which takes one string.
        // An array here gets coerced via Array.prototype.toString() (i.e.
        // comma-joined) into ONE bogus Chrome argument
        // ("--no-sandbox,--disable-dev-shm-usage,--disable-gpu") that
        // Chrome doesn't recognize as three flags — confirmed live: this
        // workflow's second CI run still crashed with "No usable sandbox!"
        // even after adding the flags, and the crash log's own
        // "switch-26" showed exactly that comma-joined single string.
        // --disable-setuid-sandbox included explicitly too, even though
        // chrome-launcher already adds it by default on its own (visible
        // in the crash logs above) — belt-and-suspenders now that the
        // flag string is finally being parsed correctly.
        chromeFlags:
          "--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu",
        // Explicit mobile emulation — frontend/CLAUDE.md's target is a
        // MOBILE score, not desktop. This mirrors Lighthouse's own
        // built-in "mobile" defaults (Moto G-class CPU/network profile,
        // 375x812 viewport) spelled out explicitly rather than relied on
        // implicitly, so a future Lighthouse default change can't
        // silently switch this to desktop.
        formFactor: "mobile",
        screenEmulation: {
          mobile: true,
          width: 375,
          height: 812,
          deviceScaleFactor: 2,
          disabled: false,
        },
        throttlingMethod: "simulate",
        throttling: {
          rttMs: 150,
          throughputKbps: 1638.4,
          cpuSlowdownMultiplier: 4,
        },
      },
    },
    assert: {
      assertions: {
        // frontend/CLAUDE.md says "Lighthouse mobile score target: > 85"
        // with no category named. Unqualified "Lighthouse score" is
        // conventionally the Performance category — and
        // docs/PROJECT_PLAN.csv's separate PWA row explicitly says
        // "Lighthouse PWA score", showing this project DOES name the
        // category when it means something other than Performance.
        // minScore 0.85 is the closest lhci-native check to "> 85" (a
        // score of exactly 85 fails closed here rather than silently
        // passing a hair under the documented bar).
        "categories:performance": ["error", { minScore: 0.85 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: "./.lighthouseci",
    },
  },
};
