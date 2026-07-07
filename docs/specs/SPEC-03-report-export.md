# SPEC-03 — Report export: JSON / Markdown / PDF for AI appraisal pipelines

## Problem

The report currently exists only as rendered HTML (plus print CSS). The team's intended
workflow is: run a plan sheet → export it **with all layers/results embedded** → feed it to an
AI assistant (Copilot/Claude) together with an in-house appraisal template → get a first-draft
site appraisal. That requires a stable, machine-readable export, plus human-friendly formats.

## User stories

1. As a consultant, I can click **Export** and choose:
   - **JSON** — complete, versioned, machine-readable (the canonical format);
   - **Markdown** — the same content as readable text, ready to paste into an AI chat alongside
     an appraisal template;
   - **PDF** — the existing print flow, one click (`window.print()` is acceptable v1).
2. The export contains **everything needed to reproduce the assessment without re-querying**:
   site geometry, every hit with its entity fields and geometry, scores, coverage %, proximity
   results, the checked-with-no-hit list, failed datasets, data-gaps notice (SPEC-06), source
   attribution and timestamps.
3. As a pipeline builder, the JSON schema is **versioned and documented** so downstream prompts
   /tools don't silently break.

## Suggested approach

**Canonical JSON schema** — new file `src/export/schema.ts` defining (and a doc
`docs/export-schema.md` describing) `PlansheetReport`:

```ts
interface PlansheetReport {
  schemaVersion: '1.0';
  generatedAt: string;              // ISO 8601
  app: { name: 'plansheet'; version: string };  // version from package.json via Vite define
  site: {
    kind: 'point' | 'polygon';
    label?: string;                 // "SW1A 1AA" / "UPRN …" / "drawn boundary"
    geometry: GeoJSON.Geometry;     // Point or (Multi)Polygon, WGS84
    areaM2?: number;
    nearestPostcode?: string;
  };
  administrative: ExportHit[];      // LPA, ward, parish… (unscored)
  constraints: ExportHit[];         // sorted: impact desc — order in array IS the ranking
  nearby?: ExportHit[];             // from SPEC-04, each with proximity block
  checkedNoHit: { dataset: string; label: string }[];
  failedDatasets: string[];         // could NOT be checked — pipelines must surface this
  dataGaps: { id: string; topic: string; whereToCheck: string }[];  // from SPEC-06 register
  attribution: string[];            // OGL, OSM, OS statements
  disclaimer: string;
}
interface ExportHit {
  dataset: string; label: string; category: string;
  entity: number; name: string; reference: string;
  entityUrl: string;                // planning.data.gov.uk/entity/{id}
  startDate?: string; qualifier?: string;   // "Grade I", "Flood Zone 3"
  impactScore: number; impactTier: string;
  coverage?: { areaM2: number; pct: number } | { count: number };   // SPEC-02
  proximity?: { distanceM: number; bearing: string; withinM: number }; // SPEC-04
  geometry?: GeoJSON.Geometry;      // include by default; "compact" option strips it
  raw: Record<string, unknown>;     // untouched entity fields from the API
}
```

Build it in `src/export/buildReport.ts` as a **pure function** of the data `main.ts` already
holds (SiteSelection, sorted hits, registry, failures, proximity results). Purity matters: the
MCP server (SPEC-05) reuses this function verbatim, and it makes testing trivial.

**Markdown renderer** — `src/export/markdown.ts`, a pure function `PlansheetReport → string`.
Structure mirrors the on-screen report: header (site, area, date), Administrative table,
Constraints as a ranked list with tier/qualifier/coverage/link, Nearby, Checked-with-no-hit as a
collapsed-style appendix list, then data gaps + disclaimer. Keep it deterministic (no locale
-dependent dates — use ISO) so downstream prompt diffs are stable.

**Download mechanics** — Blob + `URL.createObjectURL` + programmatic `<a download>`. Filenames:
`plansheet_<label-slug>_<yyyy-mm-dd>.json|.md`. Add a "Copy Markdown" button too (clipboard API)
— that's the actual gesture for pasting into an AI chat.

**"All layers active" requirement**: interpreted as *the export must be complete even if the
user toggled layers off in the UI* — exports always include every hit and its geometry,
regardless of current visibility. (A rendered map image inside the PDF is BACKLOG — see
`leaflet-image` note there; do not block this spec on it.)

**Appraisal-pipeline handshake (documentation deliverable)**: add `docs/appraisal-pipeline.md`
with a worked example: the JSON/MD export + a skeleton appraisal-template prompt
("You are a planning consultant. Using the attached plansheet report and the firm's template
below, draft an initial constraints appraisal. Flag every item in `failedDatasets` and
`dataGaps` as unverified…"). This file is where the firm's own templates get referenced later.

## Acceptance criteria

- [ ] `buildReport` unit-tested against fixtures: array order equals ranking; failed datasets
      and no-hit lists populated; schemaVersion present.
- [ ] Markdown snapshot test (fixture report → expected .md fixture, byte-identical).
- [ ] JSON export of a polygon check re-imported via SPEC-01's Boundary tab reproduces the same
      site geometry (round-trip test).
- [ ] Exports include hits whose layers are toggled off.
- [ ] Export buttons appear only after a completed check; disabled while a check runs.
- [ ] `docs/export-schema.md` and `docs/appraisal-pipeline.md` exist and match the code.
