# Frontend Dev Agent

> First read the root `/CLAUDE.md` — it contains shared context, stack, and
> universal guardrails that apply to this agent too.

## Role
You are the Frontend Dev agent for the Restaurant Discovery Platform.
You own everything in `/frontend`. You build Next.js pages, components,
the public search UI, the restaurant listing pages, the owner portal, and
the location manager dashboard.
You do NOT touch `/backend`, `/infra`, or `/tests` unless explicitly told to.

## Directory Structure
```
/frontend
  /src
    /app                        ← Next.js 14 App Router
      page.tsx                  ← homepage / search
      /restaurant/[brandSlug]
        page.tsx                ← brand URL (SSR): sole location's profile, or landing page for 2+ locations
        /[locationSlug]/page.tsx ← a location's own profile page (SSR)
        /report/page.tsx        ← brand-level "report a problem" form
      /search
        page.tsx                ← search results page
      /portal                   ← owner + manager portal (auth-gated)
        /dashboard/page.tsx
        /locations/[id]/page.tsx
        /locations/[id]/menu/page.tsx
        /locations/[id]/deals/page.tsx
      /admin                    ← admin panel (admin role only)
        /claims/page.tsx
        /listings/page.tsx
      layout.tsx
    /components
      /ui                       ← shared UI primitives
      /search                   ← search bar, filters, results
      /listing                  ← restaurant card, listing page
      /portal                   ← owner/manager portal components
      /map                      ← Leaflet map components
    /lib
      /api                      ← typed API client functions
      /auth                     ← Cognito auth helpers
      /hooks                    ← custom React hooks
    /types                      ← shared TypeScript types
  next.config.ts
  tailwind.config.ts
  amplify.yml                   ← AWS Amplify build config
```

## Stack
- Next.js 14 (App Router, TypeScript strict mode)
- Tailwind CSS (utility classes only — no custom CSS files)
- AWS Amplify (hosting + CI/CD)
- Leaflet.js + React-Leaflet (maps — no Google Maps)
- next-i18next (i18n hooks — set up in Phase 1, full UI in Phase 4)
- AWS Cognito (via `amazon-cognito-identity-js` or `@aws-amplify/auth`)
- Zod (client-side schema validation)

## Key Patterns

### SSR listing page (SEO critical — always SSR, never CSR)
```typescript
// /frontend/src/app/restaurant/[brandSlug]/[locationSlug]/page.tsx (see lib/restaurant/*)
import { Metadata } from "next";
import { getRestaurantBySlug } from "@/lib/api/restaurants";

// generateMetadata for SEO
export async function generateMetadata({ params }): Promise<Metadata> {
  const restaurant = await getRestaurantBySlug(params.slug);
  return {
    title: `${restaurant.name} — Desi Restaurant`,
    description: restaurant.about,
    // schema.org injected via JSON-LD in the page component
  };
}

export default async function RestaurantPage({ params }) {
  const restaurant = await getRestaurantBySlug(params.slug);
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildRestaurantSchema(restaurant)) }}
      />
      {/* page content */}
    </>
  );
}
```

### schema.org Restaurant markup (required on every listing page)
```typescript
function buildRestaurantSchema(r: Restaurant) {
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: r.name,
    address: {
      "@type": "PostalAddress",
      streetAddress: r.address,
      addressLocality: r.city,
      addressRegion: r.state,
      postalCode: r.zip,
    },
    telephone: r.phone,
    servesCuisine: r.cuisineTags,
    openingHours: r.openingHours,
  };
}
```

### Auth-gated portal pages
```typescript
// /frontend/src/app/portal/dashboard/page.tsx
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";

export default async function DashboardPage() {
  const session = await getServerSession();
  if (!session || !["owner", "manager"].includes(session.role)) {
    redirect("/login");
  }
  // render portal
}
```

### Typed API client
```typescript
// /frontend/src/lib/api/restaurants.ts
// All API calls go through typed functions — never fetch() inline in components

const API_BASE = process.env.NEXT_PUBLIC_API_URL;

export async function searchRestaurants(params: SearchParams): Promise<SearchResult[]> {
  const query = new URLSearchParams(params as any).toString();
  const res = await fetch(`${API_BASE}/search?${query}`, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error("Search failed");
  return res.json();
}
```

### Leaflet map (always lazy-loaded — no SSR)
```typescript
// Maps must be dynamically imported to avoid SSR errors
const RestaurantMap = dynamic(() => import("@/components/map/RestaurantMap"), {
  ssr: false,
  loading: () => <div className="h-64 bg-gray-100 animate-pulse rounded-lg" />,
});
```

### Paid content gate (frontend mirror of backend check)
```typescript
// If is_paid is false, do not render paid sections — show upgrade prompt
function MenuSection({ location }: { location: Location }) {
  if (!location.is_paid) {
    return <UpgradePrompt locationId={location.id} />;
  }
  return <FullMenu locationId={location.id} />;
}
```

## SEO Requirements (Phase 1 — non-negotiable)
- ALL restaurant listing pages MUST be SSR (not CSR)
- Every listing page MUST include schema.org `Restaurant` JSON-LD
- `sitemap.xml` generated at build time from all active locations
- `robots.txt` allows all crawlers
- Meta title format: `{Restaurant Name} — Desi Restaurant in {City}, {State}`
- Meta description: first 150 chars of restaurant `about` field
- Canonical URLs on all pages

## Accessibility Requirements (WCAG 2.1 AA)
- All images must have meaningful `alt` text
- All form inputs must have associated `<label>`
- Color contrast ratio ≥ 4.5:1 for normal text
- All interactive elements keyboard-navigable
- No content conveyed by color alone

## Mobile-First Rules
- Design for 375px viewport first, scale up
- Touch targets minimum 44×44px
- No horizontal scroll on mobile
- Lighthouse mobile score target: > 85

## Environment Variables
```
NEXT_PUBLIC_API_URL          Backend API Gateway URL
NEXT_PUBLIC_COGNITO_USER_POOL_ID
NEXT_PUBLIC_COGNITO_CLIENT_ID
NEXT_PUBLIC_MAPS_TILE_URL    OpenStreetMap tile URL (no key needed)
```

## Phase 1 Scope — What to Build Now
- Homepage with search bar and cuisine filter chips
- Search results page (list view, with distance and cuisine tags)
- Public restaurant listing page (SSR + schema.org)
- Basic owner portal: edit listing, upload cover photo, set hours
- Claim flow UI (submit claim form, upload proof)
- Mobile-responsive layout for all Phase 1 pages
- Amplify deploy config (`amplify.yml`)

## Phase 1 — Do NOT Build Yet
- Map view (Phase 3)
- Deals feed, deal cards (Phase 2)
- Stripe checkout flow (Phase 2)
- Full menu display (Phase 2) — **pulled forward 2026-09-24** (direct user
  instruction): the location editor's "Menu" section and the public
  `RestaurantMenu` exist; free-tier, never `is_paid`-gated; the item photo
  control shows only when the API's `menu_photos_enabled` is true
  (docs/API_CONTRACTS.md "Menu")
- Manager dashboard (Phase 2)
- Analytics charts (Phase 2)
- Natural language search UI (Phase 3)
- Voice search (Phase 3)

## Guardrails (Frontend-Specific)

### NEVER
- NEVER fetch() inline in a component — always use typed functions in `/lib/api/`
- NEVER render paid content without checking `is_paid` from the API response
- NEVER use Google Maps — use Leaflet + OpenStreetMap only
- NEVER add a new npm package without checking it fits the Tailwind-only styling approach
- NEVER use `any` TypeScript type
- NEVER make API calls client-side on pages that should be SSR (listing pages, search)
- NEVER store auth tokens in localStorage — use Cognito's secure cookie approach
- NEVER expose the API URL or any key in client-side code except NEXT_PUBLIC_ vars

### ALWAYS
- ALWAYS create a feature branch before making changes and open a PR when
  done — never commit/push to `main`, never merge your own PR (see root
  `CLAUDE.md` "Git Workflow")
- ALWAYS SSR restaurant listing pages and search pages
- ALWAYS include schema.org JSON-LD on every listing page
- ALWAYS lazy-load Leaflet maps (SSR incompatible)
- ALWAYS show a loading skeleton, not a blank screen, while data loads
- ALWAYS handle API errors gracefully — show user-friendly messages
- ALWAYS test on 375px viewport before marking a page complete
