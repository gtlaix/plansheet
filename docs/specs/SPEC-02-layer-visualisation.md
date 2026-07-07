# SPEC-02 — Layer visualisation: toggles, legend, coverage

## Problem

After a check, all intersecting geometries render at once in severity colours. On a constrained
site that's a soup of overlapping polygons; there is no legend, no way to isolate one layer, and
no quantification of how much of the site each constraint covers. Consultants need to *see* each
constraint in isolation and cite coverage figures ("Flood Zone 3 affects the north-eastern 18%
of the site").

## User stories

1. As a user, I see a **layer panel** listing every dataset with ≥1 hit, colour-swatched by
   severity tier, with per-layer show/hide checkboxes and "only" (solo) on hover-click.
2. As a user, hovering a report item **highlights** its geometry on the map, and hovering a map
   feature highlights its report item (two-way linking).
3. As a consultant with a polygon site (SPEC-01), each area-based hit shows **% of site covered**
   and the covered area in m²/ha, in both the layer panel and the report card.
4. As a user, I can adjust overall **overlay opacity** (single slider is enough).
5. As a user, the map has a **legend** of the five severity tiers matching the badge colours.

## Suggested approach

**Layer registry:** in `src/ui/map.ts`, replace the single `overlayGroup` with a
`Map<datasetSlug, L.FeatureGroup>` so layers toggle independently. Build the panel DOM in a new
`src/ui/layers.ts` (follow the `el()` helper pattern used in `search.ts`/`report.ts`).

**Two-way hover:** give every rendered feature and report card a shared key
(`entity` id). `layer.on('mouseover')` → add a CSS class to the card and bring the layer to
front with a thicker stroke; card `mouseenter` → `layer.setStyle(highlight)`. Keep a lookup
`Map<entityId, { layer, cardEl }>` built during render. Debounce nothing — it's cheap.

**Coverage % (polygon sites only):** in `src/geometry.ts`:

```ts
coverage(site: Polygon|MultiPolygon, constraint: Geometry): { areaM2: number; pct: number }
```

using `@turf/intersect` + `@turf/area`. Notes for the implementer:
- Constraint geometries come from `entity.geojson`; they can be MultiPolygon and occasionally
  invalid (self-intersections). Wrap `intersect` in try/catch; on failure fall back to
  `pct: null` and render "coverage n/a" rather than crashing the report.
- Point/line datasets (`tree`, `transport-access-node`) get a count instead of coverage
  ("3 protected trees on site").
- Cache results per (entityId) — recomputing on every toggle is wasteful.

**Sorting hook:** coverage should feed the severity model lightly: within the same impact score,
sort higher-coverage hits first. Do NOT let a 2% Grade I sliver drop below a 100% informational
layer — base impact score always dominates; coverage is a tiebreaker only. Add a unit test
pinning this (`tests/datasets.test.ts`).

**Legend + opacity:** static legend div (5 tiers, colours from `TIER_COLORS` in `map.ts` — do
not duplicate the hex values, import them). Opacity slider multiplies each layer's
`fillOpacity`/`opacity` style.

**Print:** the layer panel is screen-only (`@media print { display: none }`), but coverage
percentages must appear in the printed report cards.

## Acceptance criteria

- [ ] Layer panel lists exactly the datasets with hits; toggling hides/shows without re-fetching.
- [ ] Hover linking works both directions (Playwright check: hover card → layer gets highlight
      class/style).
- [ ] For a fixture site polygon and a fixture constraint polygon with a known 25% overlap, the
      computed pct is 25 ± 0.5 (unit test with turf, no network).
- [ ] Invalid constraint geometry → "coverage n/a", report still renders (unit test).
- [ ] Tree-type datasets report counts, not %.
- [ ] Legend colours are imported from `TIER_COLORS`, not hardcoded twice.
