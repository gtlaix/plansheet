# SPEC-06 — Data-gaps register: what Planning Data does NOT cover

## Problem

The most dangerous failure mode of this product is a consultant reading "no constraints found"
as "no constraints exist". The Planning Data platform is excellent but far from complete: whole
constraint classes are absent, and several present datasets only cover the minority of councils
that have submitted data. A plan sheet must therefore state, in every report and export, **what
was not checkable** — that list is itself a due-diligence checklist consultants will value.

## Deliverable 1 — the register (content)

A maintained file `packages/core/src/dataGaps.ts` (typed array) rendering to the report, the
JSON/MD exports (SPEC-03), and the MCP `data_gaps` tool (SPEC-05). Each entry:

```ts
interface DataGap {
  id: string;                    // stable slug, e.g. 'prow'
  topic: string;                 // "Public rights of way"
  category: 'absent' | 'partial'; // not on platform at all vs patchy coverage
  why: string;                   // one line: why a consultant cares
  whereToCheck: string;          // authoritative source(s)
}
```

### Category A — absent: constraint classes not on the platform at all

Seed the register with these (verify each against the live `/dataset.json` before shipping —
the platform adds datasets continually, and anything that has appeared moves to the app's
normal checking flow instead):

| Topic | Why it matters | Where to check |
|---|---|---|
| Public rights of way (footpaths/bridleways) | PROW crossing a site can block development; diversion orders take months | Definitive map — county/unitary highway authority |
| Common land & town/village greens | Development on commons needs consent; TVG registration defeats schemes | Commons register — commons registration authority |
| SSSI Impact Risk Zones | Trigger Natural England consultation far beyond SSSI boundaries | Natural England IRZ layer (magic.defra.gov.uk) |
| Surface water flood risk | The platform's `flood-risk-zone` is rivers & sea only; surface water is the bigger risk on many urban sites | EA Risk of Flooding from Surface Water maps |
| Groundwater Source Protection Zones / aquifers | Constrain drainage, contamination-sensitive uses | EA groundwater maps |
| Contaminated land (Part 2A) & historic landfill | Remediation cost/liability | LPA Part 2A register; EA historic landfill |
| Coal mining / mining legacy | Ground stability, coal authority permits | Coal Authority interactive map & reports |
| Ground stability, radon | Foundations, protective measures | BGS GeoIndex; UKHSA radon maps |
| Adopted highways & visibility splays | Access viability | Highway authority adopted-roads records |
| Utilities & easements (sewers, mains, power, pipelines) | Build-over agreements, diversions | Statutory undertakers' asset searches (e.g. water co. maps) |
| Airport/aerodrome & MOD safeguarding zones | Height limits, consultation triggers | Safeguarding maps via LPA / NATS / MOD |
| Major infrastructure safeguarding (e.g. HS2 limits) | Safeguarding directions restrict consents | DfT safeguarding directions; LPA |
| HSE consultation zones (COMAH/pipelines) | PADHI+ advice can be decisive | HSE land-use planning portal |
| Planning history: permissions, conditions, s106, enforcement, appeals | The single biggest gap — `planning-application` data exists only for pilot LPAs | LPA planning register; appeals at PINS casework portal |
| CIL charging schedules | Viability | LPA CIL pages |
| Priority habitats, protected species records, local wildlife sites | Ecology surveys and BNG baselines | MAGIC (priority habitats); local environmental records centre (species, licensed) |
| Ancient/veteran trees | Irreplaceable-habitat policy applies beyond TPOs | Woodland Trust Ancient Tree Inventory |
| Local plan site allocations & detailed policies map | Allocation status changes everything | LPA adopted policies map (platform has plan *boundaries/documents*, not full allocations) |
| Neighbourhood plan policies | Made NPs carry full weight | LPA / parish council |
| Land ownership, covenants, easements | Deliverability | HM Land Registry title (platform has parcel *shapes* only) |
| Building Regulations, EPC, party wall | Separate regimes entirely | Local authority building control; EPC register |

### Category B — partial: datasets present but with patchy coverage

Key insight for the implementer and for report copy: platform datasets split into
**national-source** (Historic England, Natural England, EA — effectively complete nationally:
listed buildings, scheduled monuments, SSSI, flood zones, green belt, etc.) and **LPA-source**
(supplied council-by-council, mostly by the ~70+ authorities in the Open Digital Planning
programme). LPA-source datasets to flag as `partial`:

- `article-4-direction-area` — absence of a hit ≠ no article 4 direction. Must verify with LPA.
- `tree-preservation-zone` / `tree` — most LPAs' TPOs are not yet on the platform.
- `conservation-area` — good national baseline exists but boundaries/updates vary; verify.
- `locally-listed-building`, `brownfield-land`, `design-code-area`, `local-plan-*`,
  `archaeological-priority-area` — participating LPAs only.
- `planning-application` — pilot LPAs only.

## Deliverable 2 — surfacing in the product

1. **Report section** "Not covered by this check" (after checked-with-no-hit): renders the
   register compactly (topic + where to check), with `partial` items *merged into the main
   results*: any LPA-source dataset with zero hits renders as "No data found — coverage of this
   dataset is incomplete; verify with the LPA" instead of implying clearance. Drive this off a
   `partialCoverage: boolean` flag added to the overlay entries in `datasets.ts`.
2. **Exports/MCP**: `dataGaps` array in the SPEC-03 schema; `data_gaps` MCP tool.
3. **Docs**: `docs/data-gaps.md` — the same register rendered as a standalone reference for
   consultants (generate it from the TS source with a small script so it can't drift;
   `npm run gen:docs`).

## Maintenance rule

Every register entry must be re-verified against `/dataset.json` when touched; when the
platform gains a dataset covering a gap (e.g. flood storage came online this way), delete the
gap entry and add the slug to the overlay in the same PR. Add a CI-friendly unit test that fails
if any `DataGap.id` collides with a live overlay slug.

## Acceptance criteria

- [ ] Register file with ≥ 20 Category-A entries and the Category-B flags above, each with
      `whereToCheck`.
- [ ] Zero-hit `partial` datasets render the "coverage incomplete" wording, never plain
      "no constraint found" (unit test on report renderer).
- [ ] Gaps appear in JSON + Markdown exports and the printed sheet.
- [ ] `docs/data-gaps.md` generated from source; regeneration is idempotent in CI.
- [ ] Collision test: no gap id matches an overlay slug.
