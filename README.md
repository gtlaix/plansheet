# PlanSheet

Every planning constraint on a site, in one sheet — for any location in England.

PlanSheet is a static single-page app built on the
[Planning Data platform](https://www.planning.data.gov.uk) (MHCLG). Give it a location —
postcode, coordinates, or a click on the map — and it generates a **PlanSheet**: a report of
every planning designation and constraint intersecting that point, from listed buildings and
conservation areas to green belt, flood risk zones and article 4 directions. Export it as
Markdown to paste straight into an AI appraisal prompt.

## How the report is ordered

1. **Administrative context** — local planning authority, district, ward, parish, region.
2. **Constraints & designations, ranked by impact** — each dataset carries an impact score
   (0–100) reflecting how strongly it constrains the planning potential of a site, with
   per-entity modifiers: a Grade I listing scores higher than Grade II, Flood Zone 3 far higher
   than Zone 2. The greatest constraint always appears first.
3. **Checked with no constraint found** — an affirmative record of every dataset queried.
   Datasets with incomplete national coverage (LPA-sourced, e.g. article 4, TPOs) are listed
   separately as "no data found", never as "clear".

## Comprehensive by construction

The app fetches the full dataset list from `GET /dataset.json` at runtime (cached 24h) and
queries **every dataset with `typology: geography`** — so new designations added to the platform
are checked automatically. A curated overlay in [`src/datasets.ts`](src/datasets.ts) supplies
category, impact score and a plain-English explanation for known datasets; anything unmapped is
still queried and reported (at a default mid impact) and logged to the console so the overlay can
be extended.

## Roadmap

The v2 scope — site boundary drawing, layer visualisation, proximity analysis, structured
report export for AI appraisal pipelines, an MCP server, and a data-gaps register — is fully
specified in [`docs/specs/`](docs/specs/README.md), alongside known issues and a backlog.

## Running locally

```bash
npm install
npm run dev      # dev server on http://localhost:5173
npm test         # unit tests (Vitest)
npm run build    # typecheck + production build to dist/
```

The `dist/` output is fully static — host it anywhere (GitHub Pages, Netlify, any web server).
Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml` (enable
**Settings → Pages → Source: GitHub Actions** in the repo once).

## External services

| Service | Used for | Key needed |
|---|---|---|
| [Planning Data API](https://www.planning.data.gov.uk/docs) | Datasets & entity intersection queries | No |
| [postcodes.io](https://postcodes.io) | Postcode ↔ coordinates | No |

No API keys are needed — the app is fully static with no backend or bundled secrets.

## Data licensing

- Planning Data © Crown copyright, [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/); some datasets carry additional attribution — see each dataset page on planning.data.gov.uk.
- Map tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (subject to the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/); use your own tile provider for heavy production traffic).
- Postcode data via postcodes.io (ONS/OS open data).

**Plansheet is not a substitute for a formal local land charges search or pre-application
advice.** Data on the platform varies in completeness by authority.
