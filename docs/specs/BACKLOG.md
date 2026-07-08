# Backlog — further improvements (roughly prioritised)

Ideas beyond the six specs. Each is a candidate future spec; sizes are order-of-magnitude
(S ≤ 1 day, M ≤ 1 week, L > 1 week) assuming the SPEC-01..06 foundations exist.

## High value for consultants

1. **Shareable links (S)** — encode the check in the URL (`?lat=&lng=` or compressed polygon,
   e.g. polyline-encoded) so a colleague opens the same plan sheet. Prerequisite for most
   collaboration features; do this early.
2. **Address search (M)** — free-text address → coordinates. Options: OS Places `find` (needs
   the user's existing OS key — natural fit) or Nominatim (keyless, usage policy applies).
   Postcode-only search is the #1 onboarding friction for non-GIS users.
3. **Saved sites & re-check alerts (M/L)** — localStorage list of saved sites; a "re-check"
   diffs current results against the saved snapshot and highlights new/changed constraints
   (platform data changes as LPAs submit). The diff logic belongs in `packages/core`.
4. **Site allocation & policy context (M)** — where `local-plan-boundary`/design-code hits
   exist, link out to the LPA's adopted policies map and show plan status; pairs with SPEC-06.
5. **Batch checking (M)** — upload CSV of postcodes/UPRNs or a multi-feature GeoJSON → table of
   results + zipped exports. Consultants triage portfolios this way. Needs request throttling
   to stay polite to the API.
6. **% coverage in severity ordering refinements (S)** — after SPEC-02, tune tiebreakers with
   consultant feedback (e.g. Flood Zone 3 at 90% coverage vs Grade II at point contact).
7. **Entity detail drawer (S/M)** — ✅ **DONE.** Each hit has an "All fields" disclosure showing
   every raw entity field (organisation, entry-date, grade, reference…) without leaving the app.

## Product/platform

8. **PDF with map images (M)** — render each severity tier's layers to a static image
   (`leaflet-image` or `html-to-image`) and include in print/PDF; the "all layers active"
   visual record. Watch OS/OSM tile licensing for reproduction in documents — OS Maps API terms
   permit this with attribution.
9. **EPSG:27700 support (S)** — ✅ **DONE.** A British National Grid easting/northing search row
   reprojects via `proj4` (lazy-loaded); verified against the SW1A 1AA control point.
10. **Dataset freshness indicator (S)** — `/dataset.json` includes entry counts and dates;
    show "data as of…" per dataset in the checked list and exports.
11. **Config-driven basemaps (S)** — ◑ **PARTLY DONE.** The tile source is now a single `BASEMAP`
    config (ISSUES-5); wiring an actual OS Maps / MapTiler provider + key is still a user decision.
12. **Hosted MCP / HTTP API (L)** — SPEC-05 is stdio-local; a small hosted wrapper (Cloudflare
    Workers would do — the core is fetch-based and stateless) lets tools like custom GPTs and
    server-side agents call it. Needs rate limiting + caching to protect the upstream API.
13. **PWA/offline shell (M)** — cache app shell + dataset list for field use; live checks still
    need connectivity.

## Engineering health

14. **E2E in CI** — ◑ **PARTLY DONE.** Hermetic Playwright e2e now gates the deploy (ISSUES-12);
    visual-regression snapshots of the report are still to do.
15. **Error telemetry (S)** — optional, privacy-respecting (self-hosted Plausible/Sentry) to
    learn which datasets fail in the wild; off by default, document clearly.
16. **Monorepo hygiene after SPEC-05 (S)** — shared eslint/prettier config, `npm run check`
    running typecheck+test+lint across workspaces, CODEOWNERS for `packages/core/datasets.ts`
    (domain-sensitive file).
17. **Overlay governance (S)** — ✅ **DONE.** [`docs/scoring-rationale.md`](../scoring-rationale.md)
    explains the tiers, base scores and per-entity modifiers in consultant terms, so score changes
    are reviewed as domain decisions. The scoring model is the product's editorial voice.
