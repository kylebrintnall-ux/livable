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
1. **Onboarding** — monthly take-home, six individual essentials inputs (savings, healthcare, education, groceries, gas/transport, utilities), down payment %, up to 5 ranked lifestyle priorities. No slogan under wordmark.
2. **Address** — wordmark + avatar icon (top). Centered address input. Free-looks counter (bottom). No profile panel. Avatar opens ProfileEditorOverlay.
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
- `GET /api/property?address=...` → Rentcast lookup → `{ address, price, beds, baths, sqft, yearBuilt }`
- `POST /api/summary` → body `{ address, price, monthlyHousing, income, housingPct, signal, cats, downPct, rate }` → Claude generates 3-paragraph summary → `{ text }`
- `GET /api/streetview?address=...` → proxies Google Street View Static API image bytes

## Anthropic model
`claude-sonnet-4-5-20241022`

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
Savings, Healthcare, Education, Family are NOT in CATS — they live in Essentials.

## Essentials model
Onboarding collects six individual dollar inputs: savings, healthcare, education, groceries, gas/transport, utilities. These are tracked as `profile.essentials` (object) and summed into `profile.essentialsTotal` (number). The treemap shows ONE Essentials tile (`id: "needs"`, label: "Essentials", color: NEEDS_COLOR #5a4e8a) whose value is `essentialsTotal`. The breakdown is for input granularity only.

## Profile editor
The `ProfileEditorOverlay` component renders all onboarding inputs pre-filled with current values (income, six essentials, down payment %, lifestyle categories). Opened via avatar icon top-right on AddressScreen. Saving calls `setProfile` in App root and closes the overlay. The wordmark on both onboarding and address screens has no slogan underneath.

## Key implementation notes
- Treemap layout: housing tile pinned left, lifestyle tiles grid 3-per-row on right
- Edge drag: `dragRef` holds drag state; RAF-throttled `moveEdge`; proportional value transfer
- `TAPER = [0.30, 0.22, 0.17, 0.13, 0.10, 0.08]` weights lifestyle categories by rank
- Scroll lock: treemap container blocks `touchmove`/`wheel`/gesture events only (not touchstart/touchend — those would break taps)
- AI summary caching: keyed on address + housingPct + rate + downPct + tile values; cached in `cachedSummary` state

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
