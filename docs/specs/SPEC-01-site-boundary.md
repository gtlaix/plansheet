# SPEC-01 — Site boundary: draw, import, and query by polygon

## Problem

Consultants appraise **sites**, not points. A point query misses constraints that clip the edge
of a site (a TPO tree in one corner, a flood zone crossing the rear boundary) and cannot answer
"how much of the site is affected". Plansheet currently only supports point checks.

## User stories

1. As a consultant, I can **draw a polygon** on the map (click vertices, double-click/Enter to
   finish, drag vertices to edit, delete) and run a check for the whole site.
2. As a consultant, I can **click a property** and use its HM Land Registry parcel as the site
   boundary in one action (the `title-boundary` dataset already gives us the polygon).
3. As a consultant, I can **paste or upload** a boundary as GeoJSON or WKT (consultants get
   these from Land Registry downloads, CAD exports, other GIS tools).
4. As a consultant, the report tells me **every constraint intersecting the site**, and the
   point-based flows (postcode/UPRN/coords/click) keep working unchanged — a point is just the
   degenerate site.

## Suggested approach

**Drawing library:** [`@geoman-io/leaflet-geoman-free`](https://github.com/geoman-io/leaflet-geoman)
(MIT) — actively maintained, supports draw/edit/drag/remove of polygons on Leaflet 1.x. Add a
small toolbar (Draw site / Edit / Clear) rather than enabling every geoman control.

**Geometry utilities:** add [`@turf/turf`](https://turfjs.org/) (modular imports only — pull
`@turf/area`, `@turf/simplify`, `@turf/buffer` etc. individually to keep the bundle small).
Turf is also required by SPEC-02 and SPEC-04, so put shared helpers in a new `src/geometry.ts`.

**State model:** introduce a single `SiteSelection` type replacing the current lat/lng-only flow:

```ts
type SiteSelection =
  | { kind: 'point'; lat: number; lng: number; label?: string }
  | { kind: 'polygon'; geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon; label?: string };
```

`main.ts#runCheck` branches on `kind`. Everything downstream (report, overlays, export) receives
the `SiteSelection` so it can show the boundary and compute areas.

**API querying by polygon:** `GET /entity.json` accepts `geometry=<WKT>` +
`geometry_relation=intersects` instead of `latitude/longitude`. Two things to handle:

1. **URL length.** These are GET requests; a detailed boundary produces a huge WKT. Before
   querying: `turf.simplify` with a tolerance chosen so the WKT stays under ~1,500 chars
   (iterate tolerance upward until it fits), and round coordinates to 6 dp. Keep the *original*
   polygon for display and area maths — only the query geometry is simplified. Verify against
   the live API what length it actually accepts and document the limit in code.
2. **Result volume + pagination.** Polygon queries can exceed the 500-entity page cap
   (`tree` and `title-boundary` in dense areas). Extend `queryEntities` in
   `src/api/planningData.ts` to follow the response's `links.next` until exhausted, with a hard
   safety cap (e.g. 2,000 entities/dataset batch → surface a "too many, zoom in" error). This
   fixes ISSUES-2 at the same time.

**Title-boundary as site (story 2):** on point-check results, the admin section already includes
the `title-boundary` hit. Add a "Use as site boundary" button next to it: fetch that entity's
geometry (`GET /entity/{id}.geojson`), set it as the `SiteSelection`, re-run as a polygon check.

**Import (story 3):** a fourth search tab "Boundary" with a textarea + file input. Accept:
GeoJSON `Feature`/`FeatureCollection`/`Geometry` (take the first Polygon/MultiPolygon) and WKT
`POLYGON`/`MULTIPOLYGON`. Parse WKT with the tiny [`wellknown`](https://www.npmjs.com/package/wellknown)
package or a hand-rolled parser (it's ~40 lines for polygons; hand-rolled avoids a dep — your
call, but test either against fixtures). Validate: ring closure, ≥4 positions, England-ish
bounding box (lat 49–56, lng −7–2), coordinates in lon/lat WGS84 order. Reject with clear
errors ("this looks like easting/northing (EPSG:27700) — reproject to WGS84 first" when values
are > 1000).

**Report additions for polygon checks:**
- Header shows site area (from `turf.area`, displayed in m² and hectares).
- Each hit is flagged **on-site** (intersects) — % coverage lands in SPEC-02.
- The boundary renders on the map as a distinct style (dashed dark outline, no fill).

## Out of scope

- Multi-site batch checks (BACKLOG).
- Snapping/measure tools beyond what geoman gives for free.
- Reprojection of EPSG:27700 inputs (detect and reject with a helpful message; auto-reproject is
  a BACKLOG item via proj4).

## Acceptance criteria

- [x] Draw → check works end-to-end; drawn boundary persists on the map with the results.
      (geoman, lazy-loaded; e2e draws four vertices and asserts the site report + boundary.)
- [x] Point flows unchanged (all existing tests pass; postcode/coords/BNG/click still work).
- [x] A polygon spanning a constraint edge reports that constraint even when the polygon's
      centroid does not intersect it — the query uses `geometry=<WKT>&geometry_relation=intersects`.
      **Live-verified 2026-07-12** (debug tool v2, check 3): the Royal Parks conservation area
      was returned for a rectangle whose centre a point query confirmed to be outside it.
- [x] Pagination: a 2-page `entity.json` response is mocked and both pages merge
      (`queryEntitiesByGeometry` test).
- [x] WKT/GeoJSON import round-trips, with the EPSG:27700 rejection message covered by unit + e2e.
- [x] "Use as site boundary" from a title-boundary hit re-runs the check with that parcel
      (`fetchEntityGeometry` unit test + e2e).
- [x] Simplification: a 500-vertex polygon produces a query WKT under the length budget
      (`MAX_QUERY_WKT_CHARS = 3500`) while the displayed boundary keeps all 500 vertices.

## Status — implemented 2026-07-08

Shipped across four commits: (1) `src/geometry.ts` + `queryEntitiesByGeometry`/`queryGeojsonByGeometry`;
(2) unified point/polygon check pipeline + paste/upload import; (3) draw-on-map via geoman; (4)
adopt a `title-boundary` hit as the site. Boundaries render as a dashed outline in a dedicated
map pane; the report/Markdown/JSON carry the site area (m² + hectares).

**Live-verified 2026-07-12 (maintainer debug runs):**
- ✅ **Edge query** (the founding guarantee): the API accepted a 4,231-char WKT (URL ~5.5k) and
  failed near 8.4k, so the simplification budget was raised 1,800 → 3,500 chars. Debug tool v2
  check 3 then confirmed the Royal Parks conservation area is returned for a rectangle whose
  centre a point query proved to be *outside* it — edge-clipping constraints are caught.
- ✅ **Title boundary** (check 7): `/entity/{id}.geojson` returns a `Feature` with `MultiPolygon`
  geometry, which the adopt-as-site flow handles.

Still nice-to-have (not blocking): compare a displayed **site area** against a GIS measurement,
and confirm WKT vs GeoJSON import of the same boundary give identical results — both exercised
by unit tests but not yet eyeballed live.

**Deferred (were in scope, split out):** shareable polygon URLs (a BACKLOG item — polygon checks
currently drop the `?lat=` param rather than encode the geometry); vertex editing after drawing
(geoman supports it; not yet wired to re-run). % site coverage per constraint is SPEC-02.
