# Validation checklist (hands-on, signed-in)

Created 2026-11-15. These features are covered by automated tests, but almost none
were exercised in a real signed-in browser session (the build agents can only run
tests and view a few signed-out pages). Tick items as you validate; report anything
off and it gets fixed in priority order.

Always check each screen at phone width (375px) as well as desktop.

## Priority 1 - risky (data or access)
- [ ] **Activation gate** (owner editor, Admin > Listings): activating a listing missing phone/hours fails and lists what is missing; `Owner deactivated` then `Active` also fails.
- [ ] **Sign-up hardening** (`/signup`): normal owner and diner sign-ups land in the right role.
- [ ] **Manager invite** (owner editor > managers; `/invite/<link>`): create invite, open in a private window, sign up/in with the invited email, accept; the manager can edit only that location.
- [ ] **Catering privacy**: a restaurant sees the requester's first name + event details only; email/phone appear only after that restaurant sends a quote.
- [ ] **Admin user actions** (Admin > Users): disable, enable, confirm, reset password on a throwaway account.
- [ ] **Bulk import** (Admin > Import): small CSV with duplicates, bad rows and the `hours` column; imports land as "Import issues".

## Priority 2 - admin console
- [ ] Grouped menu: desktop groups; phone two-level pill row; Listings open by default.
- [ ] Work queue badges: counts on Claims / Messages / Reports / Reopen requests and a total on the collapsed group.
- [ ] Summary + Search panels side by side on web, collapsed by default, state remembered.
- [ ] Summary counts on Users, Owners, Managers, Registered users, Listings.
- [ ] Listings layout: one card for single-location restaurants, child cards for 2+; missing-info chips; "Manage subscription".
- [ ] Claims: "Approved by ... on ...", verification note box, edit note afterwards.
- [ ] Assign owner (unclaimed listing) and Add owner (Owners page).
- [ ] Audit log, Taxonomy, Managers and Owners reports (quick pass).
- [ ] Reports: submit with several categories ticked; filter by category in the admin queue.
- [ ] Contact-admin inbox: send as owner, resolve as admin.

## Priority 3 - owner / manager
- [ ] Insights section on a location (view counts, 7/30/90 days; starts at zero).
- [ ] Catering, restaurant side: subscribe (admin) + opt in (editor > Catering), open `/portal/catering`, send a quote, try a decline.
- [ ] Setup checklist and Go-live bar on a listing in "Import issues".

## Priority 4 - registered diners
- [ ] Sign-up with city + ZIP; saved location form; banner for diners without a ZIP.
- [ ] Follow a restaurant; add a deal as its owner; bell alert appears; mark read.
- [ ] Search: Deals today, Open now, saved-ZIP default origin.
- [ ] Catering request wizard, restaurant limit, My requests, "not accepting" / "not found" messages.
- [ ] Your Data (`/privacy`): export and delete request.

## Priority 5 - public, signed-out
- [ ] Home popup (after 10s, "Maybe later" remembered, five benefits).
- [ ] "Sign up benefits" link beside Sign In, footer link, `/benefits`.
- [ ] "Restaurants by city" in the top bar, `/indian-restaurants`, a city page.
- [ ] Open/closed label and phone formatting on tiles and detail pages.
- [ ] Fonts look unchanged (now self-hosted).

## Known and expected (not bugs)
- 21 real restaurants are live without a phone number (they stay live; only re-activation is gated).
- The notification bell label still says "Deal alerts" but also shows catering quotes.
- The removed "Zztest" test listings stay hidden / "Import issues".
- Catering test needs a restaurant that is subscribed (admin) AND opted in (editor).
