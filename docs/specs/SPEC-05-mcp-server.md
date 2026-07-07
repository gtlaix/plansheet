# SPEC-05 — MCP server: plansheet as a tool for AI assistants

## Problem

The firm wants AI assistants (Claude, Copilot-style agents) to run constraint checks directly
during appraisal drafting — "check this boundary, then write the flood section". The Model
Context Protocol (MCP) is the standard way to expose tools to those assistants. Plansheet's
logic currently lives inside a browser bundle and can't be called by anything else.

## Deliverable

A new package `packages/mcp-server/` (npm workspace) providing an MCP server
`plansheet-mcp` that runs locally via stdio (`npx plansheet-mcp`) and exposes plansheet checks
as MCP tools. No hosted deployment in scope — consultants run it locally and register it in
their assistant's MCP config.

## Prerequisite refactor: extract the core

Move the pure, DOM-free logic out of the web app into `packages/core/` (npm workspaces;
the web app and MCP server both depend on it):

- `datasets.ts` (registry + scoring) — already pure.
- `api/planningData.ts`, `api/geocode.ts` — already `fetchFn`-injectable; Node 18+ has global
  fetch so they run server-side unchanged. **localStorage caching must be abstracted**: replace
  direct `localStorage` calls with a tiny injected `KVCache` interface (web: localStorage;
  node: in-memory Map or a JSON file in `~/.cache/plansheet/`).
- `geometry.ts`, `export/buildReport.ts`, `export/markdown.ts` (from SPEC-01/03/04).

`src/ui/*` and `main.ts` stay in the web package. Vite handles workspace deps natively; keep a
single root `npm test` running both packages' Vitest suites. This refactor is 60% of the work —
do it as its own PR before writing any MCP code.

## MCP tools to expose

Use the official [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
(TypeScript). Register with clear descriptions — the tool descriptions are prompts; write them
for an LLM audience (say what England-only means, what the impact score is).

| Tool | Input (zod schema) | Output |
|------|-------|--------|
| `check_location` | `{ postcode? , uprn?, lat?, lng? }` (exactly one addressing mode; uprn requires `OS_API_KEY` env) | `PlansheetReport` JSON (SPEC-03 schema) |
| `check_site` | `{ geometry: GeoJSON Polygon/MultiPolygon }` | `PlansheetReport` |
| `scan_surroundings` | `{ geometry or lat/lng, radiusM (≤5000), datasets? }` | nearby hits with distances (SPEC-04 logic) |
| `list_datasets` | `{}` | registry: slug, label, category, impact score, coverage caveat flag |
| `get_entity` | `{ entity: number }` | entity JSON + geojson from the platform |
| `data_gaps` | `{}` | the SPEC-06 register (id, topic, whereToCheck) |

Also expose the Markdown rendering as an output option (`format: 'json' | 'markdown'` param on
the check tools) — assistants writing prose prefer markdown input.

**Implementation notes**

- stdio transport only for v1 (`StdioServerTransport`). Log to stderr, never stdout.
- Config via env: `OS_API_KEY` (optional, UPRN lookups), `PLANSHEET_CACHE_DIR` (optional).
- Timeouts: wrap platform calls with a 30 s abort; return MCP tool errors with actionable
  messages ("planning.data.gov.uk unreachable — check network"), never crash the process.
- Respect the API: reuse the core's batching; a single `check_site` call fans out to the same
  ~5 batched requests the web app makes, no more.
- Every tool result must carry `failedDatasets`, the disclaimer, and data gaps — an LLM
  consuming a partial result MUST be able to see it is partial.
- README for the package: install, Claude Desktop / VS Code MCP config JSON snippets, example
  transcript.

## Acceptance criteria

- [ ] Workspace refactor lands first; web app behaviour and tests unchanged.
- [ ] `npx plansheet-mcp` starts; MCP `tools/list` shows the six tools with schemas.
- [ ] Integration test using the SDK's in-memory transport + mocked fetch: `check_location`
      with a postcode fixture returns a schema-valid `PlansheetReport`.
- [ ] `check_site` rejects non-England geometry and >5,000-vertex inputs with clear errors.
- [ ] UPRN tool errors helpfully when `OS_API_KEY` unset.
- [ ] Manual smoke: registered in Claude Desktop, "what constraints affect SW1A 1AA?" produces a
      correct ranked answer.
