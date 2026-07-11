# SPEC-04 — Proximity analysis: constraints within a radius

## Problem

Many planning judgements depend on *nearby* constraints, not just intersecting ones:

- Natural England consultation is triggered by development **near** a SSSI (its Impact Risk
  Zones extend far beyond the boundary — and note the IRZ dataset itself is NOT on the platform,
  see SPEC-06).
- Setting-of-heritage-assets arguments concern listed buildings/conservation areas **adjacent**
  to a site.
- Bat/newt survey triggers, ancient-woodland buffer standards (e.g. 15m root protection),
  noise/odour from nearby designations, etc.

Plansheet only answers "what touches this site". Consultants need "what is within X metres, and
how far exactly" — e.g. **"nearest SSSI boundary is 240 m north-east"**.

## User stories

1. As a consultant, after any check I can run a **proximity scan** with a radius I choose
   (presets 50 m / 100 m / 250 m / 500 m / 1 km / 2 km; free entry up to 5 km).
2. The report gains a **"Nearby constraints"** section: each off-site hit shows dataset, name,
   **minimum distance from my site boundary** (not centroid), and compass direction, sorted by
   the same impact model then by distance.
3. The map shows the search ring and nearby features in a visually distinct style (e.g. hatched
   or reduced opacity vs on-site hits).
4. Distances are honest: measured boundary-to-boundary in metres, labelled "≈" because
   geometries on the platform are generalised.

## Suggested approach

**Query:** buffer the site with `@turf/buffer` (`radius` in metres, `steps: 16`), then reuse the
SPEC-01 polygon query path (`geometry=<WKT of buffer>&geometry_relation=intersects`). Simplify
the buffer the same way (a 16-step circle WKT is small; a buffered complex polygon is not —
buffer the *simplified* site). Exclude entities already reported as on-site (match on entity id).

**Distance:** for each nearby entity, compute minimum distance site-boundary → entity-geometry:

- Implement `minDistanceMeters(a: Geometry, b: Geometry): number` in `src/geometry.ts`.
  Practical method with turf modules: explode both geometries to line segments
  (`@turf/polygon-to-line`), then for each vertex of A take `@turf/point-to-line-distance` to B
  and vice versa; the minimum of both passes is correct to a few metres at these scales, which
  is fine (state the tolerance in a code comment). If geometries intersect, distance is 0.
- Compass direction: bearing from site centroid to nearest point (`@turf/nearest-point-on-line`
  gives the nearest point; convert bearing to 16-wind rose text, "NE").

**Performance guard:** dense datasets explode inside big buffers (`tree`, `title-boundary`,
`transport-access-node`). For radii > 250 m, exclude `title-boundary` and `transport-access-node`
from the proximity scan by default (checkbox to re-enable), and cap rendered nearby features per
dataset at 50 with a "showing nearest 50" note (sort by distance before capping).

**Report/expor**t: nearby hits get `proximity: { distanceM, bearing, withinM }` in the ScoredHit
(export schema in SPEC-03 already reserves this). They do NOT count as "constraints on the site"
— keep the sections clearly separated; consultants must never mistake a nearby SSSI for an
on-site one.

**UI:** a small control under the search panel after a successful check: radius selector +
"Scan surroundings" button. Re-running with a different radius replaces the previous scan.

## Acceptance criteria

- [x] Unit tests for `minDistanceMeters`: fixture polygons with a known ~100 m gap → within
      ±5 m; overlapping/contained → 0; point and LineString features handled.
- [x] Bearing test: feature due east of site → "E" (16-wind rose).
- [x] Query excludes on-site entity ids, administrative datasets, and duplicates across
      batches (unit tests).
- [x] Nearby section renders sorted by impact then distance, with "≈ 240 m NE" formatting,
      clearly separated from on-site constraints ("NOT on the site").
- [x] Scan area + dashed nearby styling on the map (dedicated pane); cleared when a new
      check runs (e2e).
- [ ] 2 km scan over central London (manual live test) — **owed to the maintainer**, the
      build environment cannot reach the live API.

## Status — implemented 2026-07-08 (one design change)

**Envelope instead of buffer:** rather than buffering the site polygon (hard to do robustly
without a heavy dependency), the scan queries the site's bbox expanded by the radius
(`geometry=<envelope WKT>&geometry_relation=intersects`) and then filters by the *exact*
computed boundary-to-boundary distance. The envelope is only ever a superset, so no feature
within the radius is missed; distances are computed in a local equirectangular frame
(error ≪ platform geometry generalisation at ≤ 5 km) and labelled "≈".

Dense-data guard: scans > 250 m skip `transport-access-node` and `planning-application`
(noted in the report); `title-boundary` is administrative context and is never scanned.
Nearest 50 per dataset are kept. Radius presets 50 m–2 km. Nearby hits are exported in
Markdown and in the JSON schema's optional `nearby` block.

**Live checks owed:** (1) a 2 km central-London scan for responsiveness and sane result
volume; (2) whether `entity.geojson` paginates on very dense envelopes — if a batch is
silently truncated at 500 features the nearest-N claim weakens (mitigation: smaller
batches or per-dataset scan requests).
