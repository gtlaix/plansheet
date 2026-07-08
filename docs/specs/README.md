# Plansheet — Scope of Changes (v2 roadmap)

**Audience:** an engineer picking this up with no prior context. Read this file first, then the
spec you're implementing. Each spec is self-contained: problem → requirements → suggested
approach → acceptance criteria.

## What Plansheet is

Plansheet is a static single-page web app (no backend) that generates a "plan sheet" for any
location in England: a report of every planning constraint and designation intersecting that
point — listed buildings, conservation areas, green belt, flood zones, article 4 directions,
SSSIs, and ~50 more. Users are planning consultants, developers, architects and homeowners doing
initial site appraisals.

- **Live app:** https://gtlaix.github.io/plansheet/ (deployed from `main` by
  `.github/workflows/deploy.yml`)
- **Primary data source:** the [Planning Data platform](https://www.planning.data.gov.uk/docs)
  (MHCLG). Open data, no API key, CORS-enabled. Key endpoints:
  - `GET /dataset.json` — list of all datasets
  - `GET /entity.json?latitude=&longitude=&dataset=a&dataset=b&limit=500` — entities whose
    geometry intersects a point
  - `GET /entity.geojson?…` — same, as GeoJSON
  - `GET /entity.json?geometry=<WKT>&geometry_relation=intersects&dataset=…` — entities
    intersecting an arbitrary geometry (this powers the v2 polygon features)
- **Geocoding:** postcodes.io (postcode ↔ coords, keyless) and OS Places API (UPRN → coords,
  user-supplied key in localStorage).

## Current architecture (read before coding)

```
src/
├── main.ts              # orchestration: location selected → query → score → render
├── types.ts             # shared interfaces (PlanningEntity, RegistryEntry, ScoredHit…)
├── datasets.ts          # THE DOMAIN CORE: dataset registry + impact-severity model
├── api/
│   ├── planningData.ts  # dataset list (localStorage-cached), batched entity queries
│   └── geocode.ts       # postcodes.io + OS Places UPRN
└── ui/
    ├── map.ts           # Leaflet map, click-to-pin, GeoJSON overlays coloured by severity
    ├── search.ts        # tabbed inputs: postcode / coordinates / UPRN
    └── report.ts        # plan sheet renderer
```

Design decisions you must preserve:

1. **Comprehensive by construction.** The app fetches `/dataset.json` at runtime and queries
   *every* dataset with `typology: geography`. `datasets.ts` holds a curated overlay
   (category, impact score 0–100, blurb); unknown slugs still get queried with defaults and a
   console warning. Never replace this with a hardcoded list.
2. **Report order.** Administrative context first; then constraints sorted by impact score
   descending, with per-entity modifiers (listed-building grade I > II* > II; Flood Zone 3 ≫ 2).
   The scoring lives in `scoreEntity()` / `sortHits()` in `datasets.ts` — extend there, with
   unit tests (`tests/datasets.test.ts` shows the pattern).
3. **No backend, no bundled secrets.** Everything runs in the browser. Anything needing a key
   is user-supplied and stored in localStorage. (The MCP server spec, SPEC-05, is the one
   deliberate exception — it's a separate process, not part of the web app.)

Dev loop: `npm install && npm run dev` (Vite, http://localhost:5173) · `npm test` (Vitest) ·
`npm run build` (typecheck + bundle). Tests mock `fetch` with fixture JSON — all API modules
accept a `fetchFn` parameter for this. CI runs test + build on every push to `main` and deploys.

## The specs, in suggested build order

| # | Spec | What | Depends on |
|---|------|------|------------|
| 1 | [SPEC-01](SPEC-01-site-boundary.md) | Draw/import a site boundary polygon; query by geometry, not just point | — |
| 2 | [SPEC-02](SPEC-02-layer-visualisation.md) | Layer panel: toggle, legend, opacity, % site coverage per constraint | SPEC-01 |
| 3 | [SPEC-04](SPEC-04-proximity-analysis.md) | Proximity: distance from boundary to nearby constraints (e.g. nearest SSSI) | SPEC-01 |
| 4 | [SPEC-03](SPEC-03-report-export.md) | Structured report export (JSON/Markdown/PDF) for AI appraisal pipelines | SPEC-01, 02, 04 |
| 5 | [SPEC-06](SPEC-06-data-gaps-register.md) | Data-gaps register: what Planning Data does NOT cover, surfaced in every report | — (content-led; can run in parallel) |
| 6 | [SPEC-05](SPEC-05-mcp-server.md) | MCP server exposing plansheet checks to AI assistants | SPEC-01, 03, 04 (extracts their core logic) |

**Progress (2026-07-08):** SPEC-06 (data-gaps register) is shipped. **SPEC-01 (site boundary) is
shipped** — draw on the map (geoman), paste/upload GeoJSON or WKT, or adopt a `title-boundary`
parcel; the whole-site check queries `geometry=<WKT>&geometry_relation=intersects` and the report
carries the site area. The geometry query is unit-tested but still needs one live pass against the
API (see SPEC-01 "Status"). SPEC-02 is partly shipped — severity legend + per-category layer
toggles are in; opacity and **% site coverage** are now unblocked by SPEC-01 polygons. SPEC-04
(proximity) needs live buffer-query verification and SPEC-05 (MCP) is a larger architectural change;
both are best done with the maintainer in the loop. The structured JSON export (SPEC-03) already
carries the site geometry, so it's ready to feed the MCP server.

Also read: [ISSUES.md](ISSUES.md) (known bugs/risks — several are quick wins) and
[BACKLOG.md](BACKLOG.md) (further improvements, roughly prioritised).

## Cross-cutting requirements

- **TypeScript strict**; keep `tsc --noEmit` clean.
- **Unit tests** for all pure logic (geometry maths, scoring, schema serialisation) with mocked
  fetch — no test may hit the live API.
- **Verify field/dataset names against the live API before relying on them.** The overlay in
  `datasets.ts` was written against documented behaviour; `GET /dataset.json` and a spot-check
  entity are the ground truth (see ISSUES-1).
- **Respect the API.** Batch requests (12 datasets/request today), fire in parallel, never poll.
  If you add polygon queries, simplify geometry before sending (SPEC-01 explains).
- **Disclaimers stay.** Every report/export must carry the "not a substitute for a formal land
  charges search" warning and (once SPEC-06 lands) the data-gaps notice. Consultants rely on
  knowing what was and wasn't checked — silently narrowing coverage is the worst bug this
  product can have.
