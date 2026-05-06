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
3. **Map (Explore)** — three-band treemap. Tap-to-edit / pinch-to-resize lifestyle tiles. Legend below treemap. "GET YOUR ANALYSIS" CTA.
4. **Analysis (Reveal)** — verdict headline, AI summary, read-only legend. "Adjust Again" / "Share This" actions.
5. **Share** — Claude AI summary + static SVG treemap + PDF export

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
- `POST /api/summary` → body `{ property: {...}, monthlyHousing, income, essentialsTotal, housingPct, verdict, cats, lifestyleBudget, lifestyleTotal, downPct, rate }` — Claude generates ONE paragraph (60-90 words) → `{ text, summary }`. Backwards-compatible. `cats` is `{ label, kind, monthly, propertyNeed }[]`. `lifestyleBudget` = income − housing − essentials; `lifestyleTotal` = sum of recurring+savings cat monthlies.
- `GET /api/streetview?address=...` → proxies Google Street View Static API image bytes

## Anthropic model
`claude-sonnet-4-6` — the dated snapshot `claude-sonnet-4-6-20250514` was deprecated (retired circa 2026).

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

### Tile interaction (Round 10)
- **Tap** → opens edit popover (unchanged). Suppressed if `pinchActiveRef.current`.
- **Pinch (two fingers, same tile)** → scales `tile.value` proportionally to pointer distance change, snaps to nearest $25 on release. Implemented via `onPointerDown/Move/Up` on the lifestyle band container; `pinchRef` tracks `{ pointerId1, pointerId2, tileId, startDist, startValue }`; `pinchActiveRef` gates tap suppression.
- Pencil icon (12×12) appears on tiles `w ≥ 80 && h ≥ 60`.

## Legend component (Round 10)
`Legend({ tiles, income, lifestyleSurplus, modified, onReset })` — renders all tiles as icon/label/$/% rows. Housing + Essentials appear first, then lifestyle cats, then an Unallocated row if `lifestyleSurplus > 0`. "Reset" link appears top-right when `modified && onReset`. Used in MapScreen (with reset) and AnalysisScreen (read-only).

## CategoryIcon component (Round 10)
`CategoryIcon({ category, size, color })` — maps cat IDs to Lucide icons via `CATEGORY_ICON_MAP`. Fallback: `Sparkles`. Requires `lucide-react` package.

## Analysis look tracking (Round 10)
localStorage key `livable:analyzedProperties:v1` holds a JSON array of property addresses that have been analyzed. `handleRequestAnalysis()` checks if the current address is in that list — if so, analysis is free (re-analysis doesn't consume a look). If new, increments `shareCount` and adds address to the list. `shareCount >= 3` triggers paywall.

## Three-band treemap (Round 9.2)

The treemap renders three vertically-stacked bands inside a single `position: relative` container:

| Band | Height | Color | Tap |
|---|---|---|---|
| Housing | `clamp(30%, housingPct, 55%)` of container H | `HOUSING_COLOR` | Opens assumptions drawer |
| Essentials | fixed 15% of container H | `NEEDS_COLOR` | Opens profile editor |
| Lifestyle | remaining H | per-cat colors | Opens tile edit popover |

- `computeBandRects(tiles, W, H, gap)` — full-width row layout (3-per-row), no housing-left pin. Used for lifestyle band tiles.
- Unallocated tile: `lifestyleSurplus > 0` → muted striped tile fills remainder of lifestyle band. Inert.
- Deficit chip: `lifestyleSurplus < 0` → coral chip overlay on lifestyle band saying "Over by $X/mo".
- Band labels: "WHERE YOU LIVE" / "WHAT YOU NEED" / "HOW YOU LIVE" as tiny low-opacity text in top-left corner of each band.
- No FIXED badges. Band structure makes lockedness implicit.
- `lifestyleBudget = income − housingMonthly − essentialsTotal`; `lifestyleTotal = sum of recurring+savings cat monthlies`.

## Key implementation notes
- Treemap: three-band vertical layout (Housing / Essentials / Lifestyle). See Three-band treemap section above.
- Edge drag removed (Round 9)
- Scroll lock: treemap container blocks `touchmove`/`wheel`/gesture events only (not touchstart/touchend — those would break taps)
- AI summary caching: keyed on address + housingPct + rate + downPct + tile values; cached in `cachedSummary` state
- `nonTreemapCats` computed in MapScreen as `profile.cats.filter(c => c.kind !== "recurring" && c.kind !== "savings")`

## Platform strategy
- PWA is for prototyping only. The real target is native iOS, then Android.
- Do NOT over-invest in PWA-specific bug fixes. Patch what's needed for prototype testability, then move on.
- Things that go away in native iOS: input auto-zoom, scroll lock weirdness, print sheet issues, viewport-height gymnastics, navigator.share fallbacks. Don't build elaborate workarounds for any of these.

## Round 9 — Foundation audit

### Welcome screen
`WelcomeScreen` component shown when `profile == null` on load. Slogan: "Make your dream home doable."
Routing: cold-start → `"welcome"` → `"onboarding"` → `"address"`. Returning users (profile in localStorage) skip welcome and land on `"address"` directly. "Start over" in ProfileEditorOverlay goes to `"onboarding"` (skips marketing). Slogan propagated to `<title>`, `meta[name=description]`, og:description, twitter:description in `index.html`.

### Single source of truth
`profile.cats[].monthly` is the ONLY value source. No `Math.max(monthly, 1)` floor, no auto-allocation. Tile-building useEffect filters to cats where `(monthly || 0) > 0` — $0 cats don't appear in the treemap at all. `computeRects` call also filters `tiles.filter(t => t.value > 0)` to prevent NaN from 0-sum rows. `confirmEdit` allows setting to $0 (removes tile on next rebuild). `onCatAmountChange` still syncs edit → profile → localStorage → re-render chain. AI summary reads from `profile.cats` which is kept in sync. ShareScreen and PDF breakdown tables filter to `t.value > 0`.

### Tap-only interaction
Edge-drag system fully removed: `draggingEdge/hoveredEdge` state, `dragRef/rafRef`, `edgeDefs`, `startEdgeDrag`, `moveEdge`, drag useEffect, `getEdgePos`, `HANDLE_V/H`, edge handles JSX. Treemap is a pure display surface — all editing via tap → popover. Pencil icon (10×10 SVG) in bottom-right corner of unlocked tiles where rect.w ≥ 60 && rect.h ≥ 60.

### Map screen layout
Property card height: 130px (was 80px). Address: fontSize 14, fontWeight 700. Treemap container: `flex: "1 1 auto"` with no `maxHeight` cap — fills all remaining vertical space.

### PDF fixes
Treemap: 480×280 (was 110px tall — now dominant visual). SVG text uses `fill: PDF_CREAM` (solid hex, not rgba) — fixes blue text regression. Text sizes scaled for larger treemap (`pctSize` up to 28). Breakdown filters `tiles.filter(t => t.value > 0)`. Tagline updated to "MAKE YOUR DREAM HOME DOABLE".

## Round 8 — Multi-dimensional verdict system

Replaces `getSignal(housingPct)` (single-axis, housing % only) with `computeVerdict` (three-axis weighted score).

### Scoring functions
- `scoreFinancial(housingPct, tiles, profile)` — 45% weight. Housing %, buffer ratio (leftover income vs essentials), lifestyle compression (recurring cats vs income).
- `scoreLifestyle(tiles, profile)` — 30% weight. Cat-count score (more priorities = higher bar), priority alignment (top-ranked cats get higher weight), one_time / property cats penalize slightly if many.
- `scoreProperty(property, profile)` — 25% weight. `PROPERTY_NEED_KEYWORDS` maps keywords (yard, garage, basement, pool, office, studio, gym…) to property fields. `matchPropertyNeed(needString, property)` returns 0–1 match score. Property cats with no matching data score 0.5 (unknown).
- `integrateVerdict({ financial, lifestyle, property })` — weighted sum: 0.45 × F + 0.30 × L + 0.25 × P → 0–100.

### Five verdict tiers
| Score | Label | Color |
|---|---|---|
| ≥ 80 | Fits Your Life | #4A9B6F |
| ≥ 65 | Mostly Fits | #6FA876 |
| ≥ 50 | Real Trade-Off | #E8A030 |
| ≥ 35 | Stretched | #D97B3A |
| < 35 | Works Against You | #C8412A |

Each tier has `label`, `color`, `headline` (short), `subline` (housingPct-interpolated).

`computeVerdict` returns `{ label, color, headline, subline, score, financial, lifestyle, property }`. Returns safe defaults when `tiles` is empty.

### Layout changes
- **MapScreen**: Verdict headline block sits **above** the treemap (not below). Suppressed (`{housingTile && ...}`) until tiles populate to prevent first-render flicker. Block shows badge (label), headline + subline, and three mini progress bars (F / L / P scores).
- **ShareScreen header**: Full-bleed colored header (`verdict.color`) with verdict label, headline/subline, and housing % — replaces old signal badge.
- **Old signal box below treemap**: Removed.

### AI / PDF integration
- `buildSummaryPrompt` receives `verdict` alongside `signal`. Prompt includes: `Verdict: ${label} (financial fit F/100, lifestyle fit L/100, property fit P/100)`.
- `/api/pdf` accepts `verdict` (with `signal` as fallback for old clients). Badge uses `verdict.color`.

## Fixed bugs / completed work
- [x] Mobile layout: max width 430px, legend 2-col grid, photo card 2-line clamp, scroll lock scoped to treemap only
- [x] Backend wiring: frontend calls `/api/*` (not Anthropic directly); server.js handles prompt construction
- [x] Railway deploy: removed `--env-file` from start script (Railway injects env vars)
- [x] Express 5 catch-all route compatibility
- [x] iOS input zoom: all inputs use fontSize 16 (iOS zooms inputs below 16px)
- [x] Onboarding model: CATS replaced with 9 discretionary-only lifestyle categories; "Needs" renamed "Essentials" throughout; onboarding label updated to clarify essentials includes savings/healthcare/education
- [x] Round 6: cat kind field (recurring/savings/one_time/property); 3-stage pick flow; treemap filtered to recurring+savings; savings stripe; nonTreemapCats section; four-kind AI prompt
- [x] Round 7: richer property data (lotSize, propertyType, daysOnMarket, city/state/zip, lat/lng); property context helpers (describePropertyType, describeLot, describeAge, describeMarketTime, buildPropertyContext); three-dimensional AI cross-examination (financial + lifestyle + property fit); word count 60-90; photo card meta includes lot size; Just listed / 90+ days badges; /api/summary accepts nested property object with flat-field backwards compat. Lat/lng and MLS info passed to AI but never surfaced in UI.
- [x] Round 8: computeVerdict (scoreFinancial/scoreLifestyle/scoreProperty weighted 45/30/25); five verdict tiers; verdict headline above treemap (suppressed until housingTile ready); ShareScreen verdict-led header; SVG savings stripe via defs/pattern; toLocaleString("en-US") throughout; beds/baths null guards in ShareScreen and PDF meta; computeRects guard for missing housing tile.
- [x] Round 9: WelcomeScreen for cold-start users (slogan "Make your dream home doable"); routing welcome→onboarding→address; returning users skip welcome; slogan in HTML meta/og/twitter tags; single source of truth — profile.cats[].monthly drives tiles, no min(1) floor, 0-value cats excluded from treemap; tile editing persists to localStorage immediately; breakdown table filters $0 tiles; edge-drag interaction removed (tap-only); pencil icon affordance on lifestyle tiles ≥60×60; property card height 130px; treemap flex:1 without maxHeight cap; PDF treemap 480×280 (was 110px tall); PDF SVG text uses PDF_CREAM fill (fixes blue text); PDF breakdown filters $0 tiles; PDF tagline updated to slogan.
- [x] Round 9.1: restored lifestyle tiles (monthly>0 filter removed; Math.max(...,1) floor restored); Anthropic model updated to claude-sonnet-4-6 (dated snapshot deprecated); PDF SVG Text fontFamily:Helvetica-Bold replaced with fontWeight:bold (react-pdf SVG font crash); MapScreen outer wrapper uses flex:1+minHeight:0 (iOS height:100% unreliable in flex).
- [x] Round 9.2: Three-band treemap (Housing/Essentials/Lifestyle); computeBandRects for lifestyle band; band height clamps (housing 30-55%, essentials 15%, lifestyle remainder); unallocated tile when lifestyle underspent; deficit chip when overspent; band labels WHERE YOU LIVE/WHAT YOU NEED/HOW YOU LIVE; verdict sublines use lifestyle-budget dollars; AI summary receives lifestyleBudget+lifestyleTotal; WelcomeScreen subhead echoes three-band framing; Essentials band taps to profile editor; FIXED badges removed; onEditProfile prop threaded to MapScreen.
- [x] Round 9.3: PDF font — Jost registered via Font.register() from @fontsource/jost on jsDelivr CDN; fontFamily:"Jost" applied to all PDF SVG Text elements. PDF + live treemap min-size thresholds: showLabel (w≥50 && h≥20), showPercentage (showLabel && h≥28), showDollar (showLabel && h≥40); tiles below threshold render as solid colored regions with no text.
- [x] Round 9.5: Band header labels render once per band at band level (not inside tiles), zIndex:2, fontSize:8, consistent color; Housing/Essentials pct standardized to fontSize:32 with dollar at fontSize:11; F/L/P dimension bars removed from verdict box (scoring still drives label/color/subline); live tile showLabel threshold raised to w≥70 for narrow-tile legibility; pencil icon threshold raised to w≥80 && h≥60, size 12px; tile label marginBottom:3 for breathing room.
- [x] Round 10.1: Restore treemap tile readability. Lifestyle tiles: label (w≥60 && h≥40) → pct (w≥40 && h≥30) → dollar/mo (w≥80 && h≥60); icons demoted to supplementary top-right corner at same threshold as dollar; pencil stays bottom-right. Housing band shows dollar when h≥90; Essentials band shows dollar when h≥50. CATEGORY_ICON_MAP: added `style: Shirt` (was missing — caused silent Sparkles fallback); CategoryIcon now console.warns on missing categories. Jost font: @fontsource/jost installed, 400+700 imported in App.jsx, prepended to font stack as "'Jost','Futura',...". pctSize formula updated (max 28, min 11).
- [x] Round 10: Explore→Analyze→Share flow. MapScreen restructured as pure exploration surface: verdict box removed, Legend component added (icon/label/$/% rows, Reset link when tiles modified), treemap tiles simplified to icon+pct only, pinch-to-resize on lifestyle band (two-pointer gesture scales tile monthly, snaps to $25), muted CAT_COLORS, Lucide icons via CategoryIcon component, "GET YOUR ANALYSIS" CTA. AnalysisScreen added (verdict header, AI summary, read-only Legend, Adjust Again / Share This). App root: handleRequestAnalysis (checks livable:analyzedProperties:v1 localStorage — re-analyzing same property doesn't consume a look), handleGetAnalysis, handleShareFromAnalysis. Screen routing: map→analysis→share; ShareScreen onClose returns to "analysis".
