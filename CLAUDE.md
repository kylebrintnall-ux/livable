# LIVABLE — Project Context for Claude Code

## What this is
A mobile-first home affordability React app. Answers: "Does this home fit your life?"
Deployed on Railway. Live at livable.app.

## Stack
- **Frontend**: React 19 + Vite, single file `src/App.jsx`
- **Backend**: Express 5 (`server.js`), ESM (`"type": "module"`)
- **APIs**: Rentcast (property data), Anthropic Claude (AI summary), Google Street View (photo)

## Design rules — DO NOT change
- Sage green background: `#cdd4b0`
- Ink (text): `#1e1a0e`
- Cream (inverse text): `#faf5e8`
- Muted (labels): `#7a6a44`
- Font: Futura / Century Gothic / Trebuchet MS — mid-century modern, all-caps labels
- No emojis on map tiles
- Max content width: `MOBILE_MAX = 430px`

## User flow
1. **Onboarding** — monthly take-home, monthly essentials (savings, healthcare, education, groceries, utilities, transport), down payment %, up to 5 ranked lifestyle priorities
2. **Address** — property address → Rentcast lookup
3. **Map** — interactive treemap (housing vs. lifestyle). Draggable edges. Live affordability signal.
4. **Share** — Claude AI summary + static SVG treemap + PDF export

## Affordability signals
| Housing % of income | Label |
|---|---|
| ≤ 28% | Fits Your Life |
| ≤ 35% | Manageable |
| ≤ 45% | Stretched |
| > 45% | Hard to Sustain |

## Business model (UI only, not wired)
3 free "looks" (property lookups + AI summaries), then `PaywallOverlay` at $4.99/mo.

## Backend routes (`server.js`)
- `GET /api/property?address=...` → Rentcast lookup → `{ address, price, beds, baths, sqft, yearBuilt, lotSize?, propertyType?, daysOnMarket?, listedDate?, county?, city?, state?, zipCode?, latitude?, longitude? }` — optional fields omitted if Rentcast doesn't return them.
- `POST /api/summary` → body `{ property: { address, price, beds, baths, sqft, yearBuilt, lotSize?, propertyType?, daysOnMarket?, city?, state?, zipCode? }, monthlyHousing, income, essentialsTotal, housingPct, signal, cats, downPct, rate }` — Claude generates ONE paragraph (60-90 words) → `{ text, summary }`. Backwards-compatible: old flat-field requests still work. `cats` is array of `{ label, kind, monthly, propertyNeed }`.
- `GET /api/streetview?address=...` → proxies Google Street View Static API image bytes

## Anthropic model
`claude-sonnet-4-6-20250514` (full model ID — the short form `claude-sonnet-4-6` is NOT valid)

## Environment variables
| Key | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | server.js `/api/summary` |
| `RENTCAST_API_KEY` | server.js `/api/property` |
| `GOOGLE_MAPS_API_KEY` | server.js `/api/streetview` |

Set in Railway dashboard. Locally: `.env` file (gitignored). Use `npm run dev:server` to load `.env`.

## Dev workflow
```bash
npm run dev:all     # runs Express + Vite concurrently (uses concurrently package)
npm run dev         # Vite only (expects backend already running)
npm run dev:server  # Express only with .env loaded
npm run build       # Vite production build → dist/
npm start           # Express serves dist/ (Railway production)
```

Vite dev proxy: `/api/*` → `http://localhost:3001` (set in `vite.config.js`).

## Lifestyle categories (CATS) — discretionary only
```js
{ id: "travel" }, { id: "dining" }, { id: "hobbies" }, { id: "social" },
{ id: "subscriptions" }, { id: "pets" }, { id: "fitness" }, { id: "style" }, { id: "giving" }
```
Savings, Healthcare, Education, Family are NOT in CATS — they live in Essentials (the `needs` tile, id: "needs", label: "Essentials", color: NEEDS_COLOR #5a4e8a).

## Essentials model
Onboarding collects six individual dollar inputs: savings, healthcare, education, groceries, gas/transport, utilities. These are tracked as `profile.essentials` (object) and summed into `profile.essentialsTotal` (number). The treemap shows ONE Essentials tile (`id: "needs"`, label: "Essentials", color: NEEDS_COLOR #5a4e8a) whose value is `essentialsTotal`. The breakdown is for input granularity only.

## Profile editor
The `ProfileEditorOverlay` component renders all onboarding inputs pre-filled with current values (income, six essentials, down payment %, lifestyle categories). Opened via avatar icon top-right on AddressScreen. Saving calls `setProfile` in App root and closes the overlay. The wordmark on both onboarding and address screens has no slogan underneath.

## Profile persistence
Profile is saved to `localStorage` under key `livable:profile:v1` on first completion and on every profile editor save. On app load, `loadProfile()` hydrates the profile and skips onboarding if a valid profile is found. The "Start over" link in ProfileEditorOverlay calls `clearProfile()` and resets to onboarding. Migration: old profiles with string cats auto-migrate to full objects; Round 5 cats without `kind` default to `kind: "recurring"`.

## Lifestyle categories — `kind` field (Round 6)
`profile.cats` is an array of objects: `{ id, label, custom, kind, monthly, propertyNeed }`

Four kinds:
- `"recurring"` — monthly spend (e.g. dining, gym). Has `monthly`. Shown in treemap.
- `"savings"` — monthly saving toward a goal. Has `monthly`. Shown in treemap with diagonal stripe pattern.
- `"one_time"` — a one-time cost (gear, trip, event). `monthly: null`. NOT in treemap.
- `"property"` — a physical requirement from the home (yard, garage, extra room). `monthly: null`, `propertyNeed: string`. NOT in treemap.

Treemap only shows `kind === "recurring"` and `kind === "savings"` tiles. `savings` tiles get a diagonal stripe via `repeating-linear-gradient` using `darkenHex(color, 25)`.

Non-treemap cats (`one_time` + `property`) appear in an "Also matters to you" pill row below the verdict in MapScreen.

3-stage pick flow (OnboardingScreen + ProfileEditorOverlay):
1. Tap cat → show 4 kind buttons
2. Select kind → show detail input (amount for recurring/savings; property need string for property; one_time auto-confirms)
3. Confirm → cat added with full shape

Custom cat adds a label stage before kind selection.

Helper functions:
- `darkenHex(hex, amt)` — darkens a hex color by `amt` per channel
- `catKindSublabel(cat)` — returns display sub-label string for a cat object

## Key implementation notes
- Treemap layout: housing tile pinned left, lifestyle tiles grid 3-per-row on right
- Edge drag: `dragRef` holds drag state; RAF-throttled `moveEdge`; proportional value transfer
- Scroll lock: treemap container blocks `touchmove`/`wheel`/gesture events only (not touchstart/touchend — those would break taps)
- AI summary caching: keyed on address + housingPct + rate + downPct + tile values; cached in `cachedSummary` state
- `nonTreemapCats` computed in MapScreen as `profile.cats.filter(c => c.kind !== "recurring" && c.kind !== "savings")`

## Platform strategy
- PWA is for prototyping only. The real target is native iOS, then Android.
- Do NOT over-invest in PWA-specific bug fixes. Patch what's needed for prototype testability, then move on.
- Things that go away in native iOS: input auto-zoom, scroll lock weirdness, print sheet issues, viewport-height gymnastics, navigator.share fallbacks. Don't build elaborate workarounds for any of these.

## Fixed bugs / completed work
- [x] Mobile layout: max width 430px, legend 2-col grid, photo card 2-line clamp, scroll lock scoped to treemap only
- [x] Backend wiring: frontend calls `/api/*` (not Anthropic directly); server.js handles prompt construction
- [x] Railway deploy: removed `--env-file` from start script (Railway injects env vars)
- [x] Express 5 catch-all route compatibility
- [x] iOS input zoom: all inputs use fontSize 16 (iOS zooms inputs below 16px)
- [x] Onboarding model: CATS replaced with 9 discretionary-only lifestyle categories; "Needs" renamed "Essentials" throughout; onboarding label updated to clarify essentials includes savings/healthcare/education
- [x] Round 6: cat kind field (recurring/savings/one_time/property); 3-stage pick flow; treemap filtered to recurring+savings; savings stripe; nonTreemapCats section; four-kind AI prompt
- [x] Round 7: richer property data (lotSize, propertyType, daysOnMarket, city/state/zip, lat/lng); property context helpers (describePropertyType, describeLot, describeAge, describeMarketTime, buildPropertyContext); three-dimensional AI cross-examination (financial + lifestyle + property fit); word count 60-90; photo card meta includes lot size; Just listed / 90+ days badges; /api/summary accepts nested property object with flat-field backwards compat. Lat/lng and MLS info passed to AI but never surfaced in UI.
