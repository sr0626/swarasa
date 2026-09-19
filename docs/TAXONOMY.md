# Platform Taxonomy

This file is the source of truth for all taxonomy tags used in the platform.
The backend agent reads this file to generate the database seed script.
Admin can add new tags via the admin panel — this file should be kept in sync.

---

## Regional Cuisine Tags
`category = "regional"`

| Tag Name | Display Name | Notes |
|---|---|---|
| andhra | Andhra | Andhra Pradesh — known for spicy curries, gongura |
| telangana | Telangana | Hyderabadi biryani, mirchi ka salan |
| tamil | Tamil Nadu | Idli, dosa, filter coffee, Chettinad |
| chettinad | Chettinad | Sub-region of Tamil — distinctly spiced |
| kerala | Kerala | Seafood, appam, coconut-based curries |
| karnataka | Karnataka | Bisi bele bath, Mysore masala dosa |
| north_indian | North Indian | Broad category: dal makhani, naan, paneer |
| punjabi | Punjabi | Butter chicken, sarson da saag, tandoori |
| gujarati | Gujarati | Thali, dhokla, farsan, sweet-leaning |
| rajasthani | Rajasthani | Dal baati churma, laal maas |
| mughlai | Mughlai | Biryani, kebabs, rich gravies |
| hyderabadi | Hyderabadi | Dum biryani, haleem, Irani chai |
| bengali | Bengali | Fish curries, mishti doi, rasgulla |
| maharashtrian | Maharashtrian | Vada pav, misal pav, puran poli |
| goan | Goan | Vindaloo, xacuti, fish curry rice |
| bihari | Bihari | Litti chokha, sattu |
| odia | Odia | Dalma, pakhala, Jagannath temple prasad |
| kashmiri | Kashmiri | Rogan josh, yakhni, wazwan feast |
| indo_chinese | Indo-Chinese | Hakka noodles, Manchurian — fusion category |
| south_indian | South Indian | Broad category when specific state unknown |
| street_food | Street Food | Chaat, pani puri, bhel puri focused menus |

---

## Dietary Tags
`category = "dietary"`

| Tag Name | Display Name | Notes |
|---|---|---|
| vegetarian | Vegetarian | No meat, may include dairy and eggs |
| vegan | Vegan | No animal products |
| jain | Jain | No root vegetables, strict vegetarian |
| halal | Halal | Halal-certified meat only |
| gluten_free | Gluten Free | Gluten-free options available |
| nut_free | Nut Free | Nut-free options available |

---

## Restaurant Type Tags
`category = "type"`

| Tag Name | Display Name | Notes |
|---|---|---|
| dine_in | Dine-in | Table service |
| takeout | Takeout | Counter or phone orders |
| delivery | Delivery | Delivers to home (own delivery or third party) |
| buffet | Buffet | All-you-can-eat buffet service |
| food_truck | Food Truck | Mobile location |
| fast_casual | Fast Casual | Counter service, no table wait |
| fine_dining | Fine Dining | White-tablecloth, full service |
| catering | Catering | Events and large orders |
| cloud_kitchen | Cloud Kitchen | Delivery-only, no dine-in |
| dhaba | Dhaba | Roadside / casual highway-style |

---

## Signature Offering Tags
`category = "signature"`
Used for craving-based search ("I want Biryani") and filter chips.

| Tag Name | Display Name | Notes |
|---|---|---|
| biryani | Biryani | Any style — Hyderabadi, Lucknowi, etc. |
| dosa | Dosa | Crispy crepes — plain, masala, varieties |
| idli | Idli | Steamed rice cakes |
| chai | Chai | Masala chai, Irani chai, cutting chai |
| chaat | Chaat | Pani puri, bhel, sev puri, dahi puri |
| tandoor | Tandoor | Tandoori chicken, naan, roti from clay oven |
| curry | Curry | Broad curry selection — not specific |
| thali | Thali | Full meal platter — vegetarian or non-veg |
| kebab | Kebab | Seekh, shami, reshmi, galouti |
| haleem | Haleem | Slow-cooked meat and lentil stew |
| pav | Pav | Vada pav, pav bhaji, misal pav |
| seafood | Seafood | Fish, prawn, crab specialties |
| sweets | Indian Sweets | Gulab jamun, rasgulla, barfi, ladoo |
| breakfast_menu | Breakfast Menu | Morning-specific menu items (named `breakfast_menu`, not `breakfast`, because `cuisine_tag.name` is globally unique and the `dining_time` tag below already owns `breakfast`) |
| lunch_buffet | Lunch Buffet | Midday buffet service specifically |
| lassi | Lassi | Sweet or salted yoghurt drink |
| paratha | Paratha | Stuffed or plain flatbreads |
| uttapam | Uttapam | Thick pancake variant of dosa |
| appam | Appam | Kerala lace-edged rice pancake |
| chole | Chole Bhature | Chickpea curry with fried bread |

---

## Dining Time Tags
`category = "dining_time"`
Used for "open for lunch" / "late night" type filters.

| Tag Name | Display Name | Hours Guidance |
|---|---|---|
| breakfast | Breakfast | Opens before 10am |
| lunch | Lunch | Open 11am–3pm |
| dinner | Dinner | Open after 5pm |
| late_night | Late Night | Open after 10pm |
| brunch | Brunch | Weekend late-morning service |
| open_24h | Open 24 Hours | Round the clock |

---

## Seed Script Notes for Backend Agent

When seeding the database from this file:
- Insert all tags into the `cuisine_tag` table
- Fields: `name` (tag name column), `display_name` (display name column), `category` (category column), `is_active = true`
- Use `INSERT ... ON CONFLICT (name) DO NOTHING` so re-running the seed is safe
- Order: insert `regional` first, then `dietary`, `type`, `signature`, `dining_time`
- These are platform-controlled tags — no public API to create them
- Only admin users can add, rename, or deactivate tags via the admin panel
- **Tag names are globally unique** across categories (`cuisine_tag.name` has a single unique constraint), so no two sections may share a Tag Name (this is why the signature tag is `breakfast_menu`, not `breakfast`)

### How the seed is implemented and run
- The `seed_taxonomy` management command (`backend/app/scripts/seed_taxonomy.py`) reads `backend/app/scripts/taxonomy.json` — a copy of the tables above baked into the Lambda image (`docs/` is not in the image). Insert-if-missing by `name`; existing rows are never overwritten.
- **When you edit this file, regenerate `taxonomy.json` from the tables** (don't hand-edit); `tests/unit/test_seed_taxonomy.py` fails if they drift.
- Run (after the backend image containing the command is deployed): `aws lambda invoke --function-name <backend-lambda-name> --cli-binary-format raw-in-base64-out --payload '{"_management_command": "seed_taxonomy"}' /dev/stdout` — returns `{"ok": true, "command": "seed_taxonomy", "inserted": N, "already_present": M}`.
