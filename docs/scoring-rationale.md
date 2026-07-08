# PlanSheet impact-scoring rationale

This document explains **why each planning designation is scored the way it is**. The scores are
the product's editorial voice — they decide the order a consultant reads constraints in, so they
should be reviewed as *domain decisions*, not code tweaks. The numbers live in one place,
[`src/datasets.ts`](../src/datasets.ts) (the `OVERLAY` table and the modifier functions); this
file is the human rationale for them.

## The model in one paragraph

Every constraint dataset has a base **impact score, 0–100**, reflecting how strongly that
designation constrains the *planning potential* of a site. The report shows **administrative
context first** (LPA, ward, parish, region — never scored), then **constraints in descending
score order**. Some datasets then get a **per-entity modifier** — a Grade I listing outranks a
Grade II one; Flood Zone 3 far outranks Zone 2 — because the specific record matters more than the
dataset it came from. Ties break alphabetically for stable output. Absence of a hit is *not*
scored as "clear" for datasets with incomplete national coverage (see Coverage honesty below).

## Impact tiers (badge bands)

`impactTier()` maps a score to the badge a reader sees:

| Tier | Score | Reading |
|---|---|---|
| **Very high** | ≥ 85 | Statutory designation that can stop or reshape a scheme (listing, scheduling, SSSI, WHS). |
| **High** | 65–84 | Strong policy presumption against harm (Green Belt, AONB, conservation area, Flood Zone 3). |
| **Medium** | 45–64 | A material consideration that shapes design/assessment (Flood Zone 2, article 4, main river). |
| **Low** | 20–44 | Worth noting; rarely decisive on its own. |
| **Informational** | < 20 | Context, opportunity, or noise (brownfield register, ALC "urban", transport nodes). |

## Why the ordering, with the worked example

The founding requirement: *"if a site is a Grade I listed building and most of it is in Flood
Zone 1, the listing should be at the top — the heritage risk is greater than the flood risk."*
That is exactly what the scores encode: `listed-building` Grade I = 98 (very high) sorts above
`flood-risk-zone` Zone 2 = 50 (medium), and Flood Zone 1 (no Zone 2/3 hit) is not a constraint at
all. Heritage/ecology statutory designations therefore sit at the top of the range, landscape and
flood policy in the upper-middle, local restrictions in the middle, and registers/allocations low.

## Base scores by tier (representative — full list in `datasets.ts`)

**Statutory heritage (top):** scheduled-monument 95 · world-heritage-site 92 · protected-wreck 90 ·
building-preservation-notice 88 · listed-building 85 base · listed-building-outline 85 · WHS buffer
zone 72 · heritage-at-risk 70 · conservation-area 68 · park-and-garden 66 · battlefield 65 ·
non-designated archaeology (national importance) 58 · heritage-action-zone 52.

**Statutory ecology:** SSSI / SAC / SPA / Ramsar 90 · ancient-woodland 85 · national-nature-reserve
80 · common-land-and-village-green 55 · nutrient-neutrality-catchment 55 · wildbelt 50 ·
best-and-most-versatile-agricultural-land 48 · local-nature-reserve 48 · open-space 45 · SANG 35 ·
local-nature-recovery-strategy 32.

**Flood & water:** flood-storage-area 75 (functional floodplain) · coastal-change-management-area
65 · main-river 55 · flood-risk-zone 50 base · internal-drainage-district 25.

**Landscape & policy:** green-belt 78 · metropolitan-open-land 77 · national-park 77 · AONB 76 ·
local-green-space 70 · protected-view 60 · heritage-coast 60.

**Hazard & safeguarding:** control-of-major-accident-hazards-site 60 · contaminated-land 58 ·
safety-hazard-area 55 · hs2-safeguarded-area 55 · military-explosives-site 50 · aerodrome 45 ·
historic-stone-quarry 38 · safeguarded-wharf 35.

**Local restrictions:** article-4-direction-area 55 · tree-preservation-zone 50 · tree 48 ·
asset-of-community-value 42 · air-quality-management-area 38.

**Informational:** infrastructure-project 35 · agricultural-land-classification 30 base ·
mineral-safeguarding-area 30 · central-activities-zone 25 · employment-allocation 25 ·
design-code-area 22 · brownfield-land/site 20 · development-plan boundaries 15–18 · educational
establishment 12 · transport-access-node 8 · waste-plan-boundary 8.

Datasets not in the overlay are still queried (comprehensive-by-construction) and land at the
**default score of 40** until someone assigns them a considered value here.

## Per-entity modifiers (the record beats the dataset)

- **Listed building / park-and-garden grade** — grade replaces the base: listing **I = 98,
  II\* = 93, II = 85**; park-and-garden **I = 75, II\* = 70, II = 66**. Grade is the single biggest
  determinant of heritage weight, so it must drive the ranking, not the flat dataset score.
- **Flood risk level** — **Zone 3 = 80** (high probability; often precludes vulnerable uses) vs
  **Zone 2 = 50** (medium). This is a factor-of-two policy difference, so they must not share a
  rank. A point with no Zone 2/3 hit is Flood Zone 1 and simply not listed as a constraint.
- **Agricultural Land Classification grade** — only interesting when the land is farmed:
  best-and-most-versatile **Grade 1 = 50, 2 = 48, 3a = 45**; poorer **3b/3 = 22, 4 = 18, 5 = 15**;
  **"Urban" / "Non-agricultural" = 8** (informational — it is noise on a developed site).
- **Article 4 direction** — not a score change but a detail: the report surfaces *what permitted
  development right the direction removes*, because "there's an article 4 here" is far less useful
  to a planner than "it removes the C3→C4 (HMO) permitted change of use".

## Coverage honesty (why a zero-hit is not always "clear")

Datasets flagged `partialCoverage` in the overlay are LPA-sourced and nationally incomplete
(article 4, TPOs, conservation areas, brownfield/design-code registers, contaminated land, commons…).
For these, "no data returned" means *no data*, not *no constraint* — the report and exports put
them under **"No data found — coverage incomplete"**, never in the affirmative "checked, clear"
list. Silently narrowing coverage is the worst bug this product can have.

## Changing a score

Edit the `OVERLAY` entry (or a modifier table) in `src/datasets.ts` and update the reasoning here
in the same change. The unit tests in `tests/datasets.test.ts` pin the *ordering guarantees*
(admin first; Grade I above Flood Zone 2; tier boundaries), so a re-tune that breaks an intended
ordering will fail CI — by design.
