# Known issues, bugs and risks

Numbered for cross-referencing from specs/PRs. Severity: 🔴 correctness · 🟠 robustness · 🟡 polish.

## 🔴 ISSUES-1 — Overlay table unverified against the live dataset list

> **STATUS: RESOLVED (reconciled 2026-07-07 against the MHCLG catalogue,
> `digital-land/specification`: `specification/dataset.csv` + `dataset-field.csv`).**
The overlay was written against documented behaviour because the sandbox can't reach
`planning.data.gov.uk`. Reconciled via WebFetch of the GitHub specification instead: the full
`typology: geography` list was diffed against OVERLAY and ~35 previously-unranked datasets were
added with categories/scores; the "England Border" layer was confirmed as the `border` slug (not
`boundary`) and excluded along with the addressing layers (`address`/`postcode`/`street`/`uprn`);
`minerals-plan-boundary` was corrected to `mineral-safeguarding-area`; and the modifier fields
`agricultural-land-classification-grade` and article-4 `permitted-development-rights` were
confirmed. Entity-level *values* (whether a given authority populated a field) still warrant a
live spot-check on first real use.

## 🔴 ISSUES-2 — No pagination on entity queries

> **STATUS: FIXED (pagination via links.next, MAX_PAGES_PER_BATCH cap)**
`queryEntities` requests `limit=500` and ignores `links.next`. Point checks rarely exceed this,
but polygon/buffer checks (SPEC-01/04) will, silently truncating results — unacceptable for a
due-diligence tool. Fix in SPEC-01 (follow `links.next`, hard cap + explicit error).

## 🔴 ISSUES-3 — Zero-hit ≠ clear for LPA-sourced datasets

> **STATUS: FIXED (partialCoverage flags + "No data found — coverage incomplete" section; data-gaps register in report)**
"Checked with no constraint found" currently implies clearance for datasets whose national
coverage is incomplete (article 4, TPO…). Misleading for consultants. Fixed by SPEC-06
deliverable 2 (`partialCoverage` flag + wording). Until then the report disclaimer is the only
guard — prioritise this.

## 🟠 ISSUES-4 — `<details>` content may be skipped when printing

> **STATUS: FIXED (beforeprint/afterprint handlers open and restore details)**
The "checked with no constraint found" list is inside a collapsed `<details>`; browsers vary on
printing closed details even with the current CSS. Fix: `window.addEventListener('beforeprint')`
→ set `open = true` (and restore on `afterprint`).

## 🟠 ISSUES-5 — OSM public tiles unsuitable for heavy production use
`tile.openstreetmap.org` has a fair-use policy; a firm-wide tool should switch to a proper
provider (OS Maps API vector/raster tiles — free tier, and more appropriate basemap for UK
planning work; or MapTiler/Carto). Config-driven tile URL + attribution; keep OSM as default
fallback for personal use.

## 🟠 ISSUES-6 — Reverse-geocode postcode can mislabel rural points

> **STATUS: FIXED (nearest postcode suppressed beyond 200 m)**
Header shows nearest postcode even when it's hundreds of metres away. Show distance when
postcodes.io returns it, or suppress beyond ~200 m.

## 🟠 ISSUES-7 — No request cancellation

> **STATUS: FIXED (AbortController cancels superseded runs)**
Rapid successive checks: stale renders are guarded by `runToken`, but the superseded fetches
still run, wasting API quota and briefly mis-ordering `search.setBusy`. Pass an `AbortController`
signal through `fetchFn`, abort on new run.

## 🟠 ISSUES-8 — Dataset cache lacks schema versioning

> **STATUS: FIXED (schemaVersion field in dataset cache)**
`plansheet-datasets-v1` localStorage cache: bump key when the stored shape changes, and treat
JSON parse errors as cache-miss (currently handled) — but add a `schemaVersion` field so future
migrations are explicit.

## 🟡 ISSUES-9 — Tabs are not accessible

> **STATUS: FIXED.** The tab strip was removed with the search-panel redesign. Remaining a11y
> items are now done: the report is a labelled `role="region"` landmark with a described
> constraints list, severity badges carry an `aria-label` ("Impact rating: …"), and the map is
> keyboard-operable — focus it and press Enter to check the current centre (arrow keys pan). The
> coordinates row remains the primary keyboard path. Covered by e2e assertions.

## 🟡 ISSUES-10 — `title-boundary` renders with empty name

> **STATUS: FIXED ("Registered title (INSPIRE …)" label)**
Point checks show the parcel hit as its reference (INSPIRE id) — cosmetic; label it
"Registered title (INSPIRE {ref})". Becomes user-facing with SPEC-01's "use as site boundary".

## 🟡 ISSUES-11 — England-only messaging is reactive

> **STATUS: FIXED (England bounding-box prefilter before querying)**
Clicks in Scotland/Wales/sea run a full (empty) check before the "may be outside England" note.
Cheap geofence: bounding-box prefilter + message before querying; don't over-invest, the
admin-hit check is the real signal.

## 🟡 ISSUES-12 — Playwright smoke test is not in CI

> **STATUS: FIXED (ported to `tests/e2e/report.spec.ts` with `@playwright/test`; runs in the
> deploy workflow before build via `npm run test:e2e`).**
The stubbed-API UI test now lives in `tests/e2e/` (six hermetic specs, routes stubbed exactly as
the unit fixtures) and gates the deploy. No live API calls in CI. Locally, point at the
pre-installed browser with `PW_CHROMIUM=/opt/pw-browsers/chromium-*/chrome-linux/chrome`.
