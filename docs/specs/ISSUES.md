# Known issues, bugs and risks

Numbered for cross-referencing from specs/PRs. Severity: 🔴 correctness · 🟠 robustness · 🟡 polish.

## 🔴 ISSUES-1 — Overlay table unverified against the live dataset list
`src/datasets.ts` OVERLAY was written against documented platform behaviour; the build
environment could not reach `planning.data.gov.uk`. Unmapped live slugs are still queried (by
design) but land unranked in "Other designations", and any *misspelt* overlay slug silently
never matches. **Task:** dump `GET /dataset.json`, diff `typology: geography` slugs against
OVERLAY keys, fix spellings, add overlay entries for anything notable that's missing
(candidates seen in the wild: `heritage-coast`? `national-nature-reserve`? `flood-storage-area`?
— confirm each exists), and record the reconciliation date in a comment. Also verify per-entity
field names used by modifiers: `listed-building-grade`, `flood-risk-level`, and the
park-and-garden grade field (we currently fall back to `grade`).

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

> **STATUS: FIXED for tabs (ARIA roles, roving tabindex, arrow keys); map keyboard alternative and report screen-reader pass still open**
Tab buttons lack `role="tab"`, `aria-selected`, arrow-key navigation; panels lack
`role="tabpanel"`/`aria-labelledby`. Map lacks a keyboard alternative for click-to-check
(coordinates tab mitigates). Screen-reader pass wanted on the report (headings hierarchy is
sound; badges need `aria-label` since colour conveys tier).

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
The stubbed-API UI test lives in session scratch only. Port it to `tests/e2e/` with
`@playwright/test`, stub routes exactly as unit fixtures do, run in the deploy workflow before
build. Keep it hermetic — no live API calls in CI.
