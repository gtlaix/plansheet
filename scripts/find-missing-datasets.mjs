#!/usr/bin/env node
// Find Planning Data geography datasets that PlanSheet queries but hasn't yet
// enriched (category + impact score + blurb) in src/datasets.ts.
//
// The app is "comprehensive by construction": it queries EVERY geography
// dataset, and any slug missing from the curated OVERLAY is still checked but
// ranked at the default impact and filed under "Other designations". This
// script lists those un-enriched datasets — ordered by how many entities they
// have, i.e. how often they'll actually show up — so the gaps can be filled.
//
// Usage (needs Node 18+ for global fetch; nothing to install):
//   node scripts/find-missing-datasets.mjs
//
// It prints a table and writes missing-datasets.md + missing-datasets.json.
// Send those to Claude and it will assign sensible categories/scores/blurbs.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API = 'https://www.planning.data.gov.uk/dataset.json';
const here = dirname(fileURLToPath(import.meta.url));
const datasetsPath = join(here, '..', 'src', 'datasets.ts');

/** Pull the OVERLAY keys and EXCLUDED_SLUGS out of src/datasets.ts (as text). */
async function readCuratedSlugs() {
  const src = await readFile(datasetsPath, 'utf8');

  // OVERLAY entries are one per line: `'slug': { … }` or `slug: { … }`.
  const overlayStart = src.indexOf('export const OVERLAY');
  const overlayBody = src.slice(overlayStart, src.indexOf('\n};', overlayStart));
  const overlay = new Set();
  for (const line of overlayBody.split('\n')) {
    const m = /^\s*'?([a-z0-9-]+)'?\s*:\s*\{/.exec(line);
    if (m) overlay.add(m[1]);
  }

  // EXCLUDED_SLUGS = new Set<string>(['border', 'address', …]);
  const exclLine = /EXCLUDED_SLUGS\s*=\s*new Set<[^>]*>\(\[([^\]]*)\]/.exec(src);
  const excluded = new Set(
    exclLine ? [...exclLine[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]) : [],
  );

  return { overlay, excluded };
}

async function main() {
  const { overlay, excluded } = await readCuratedSlugs();
  console.log(`Curated overlay: ${overlay.size} slugs · excluded: ${excluded.size}`);

  const res = await fetch(API);
  if (!res.ok) throw new Error(`${API} returned ${res.status}`);
  const { datasets } = await res.json();

  const geography = datasets.filter((d) => d.typology === 'geography');
  const missing = geography
    .filter((d) => !overlay.has(d.dataset) && !excluded.has(d.dataset))
    .map((d) => ({ dataset: d.dataset, name: d.name, entities: d['entity-count'] ?? 0, themes: d.themes ?? [] }))
    .sort((a, b) => b.entities - a.entities);

  // Overlay entries that are no longer geography datasets on the API (stale).
  const apiSlugs = new Set(datasets.map((d) => d.dataset));
  const geoSlugs = new Set(geography.map((d) => d.dataset));
  const stale = [...overlay].filter((s) => !geoSlugs.has(s) && !excluded.has(s));

  console.log(`\nGeography datasets on the API: ${geography.length}`);
  console.log(`Un-enriched (queried at default impact): ${missing.length}\n`);
  if (missing.length) {
    console.log('slug'.padEnd(48), 'entities'.padStart(10), '  name');
    for (const m of missing) {
      console.log(m.dataset.padEnd(48), String(m.entities).padStart(10), '  ' + m.name);
    }
  } else {
    console.log('None — every geography dataset is enriched. 🎉');
  }
  if (stale.length) {
    console.log(`\n⚠ Overlay slugs not found as geography on the API (verify/rename): ${stale.join(', ')}`);
    console.log(`  (present on API under another typology: ${stale.filter((s) => apiSlugs.has(s)).join(', ') || 'none'})`);
  }

  const md = [
    '# PlanSheet — un-enriched geography datasets',
    '',
    `Generated ${new Date().toISOString().slice(0, 10)} from ${API}.`,
    `${missing.length} geography dataset(s) are queried but have no curated category/score.`,
    '',
    '| slug | entities | name |',
    '| --- | ---: | --- |',
    ...missing.map((m) => `| \`${m.dataset}\` | ${m.entities.toLocaleString()} | ${m.name} |`),
    '',
    ...(stale.length ? ['## Possibly-stale overlay slugs (not geography on the API)', '', ...stale.map((s) => `- \`${s}\``), ''] : []),
  ].join('\n');

  await writeFile(join(process.cwd(), 'missing-datasets.md'), md);
  await writeFile(join(process.cwd(), 'missing-datasets.json'), JSON.stringify({ missing, stale }, null, 2));
  console.log('\nWrote missing-datasets.md and missing-datasets.json — send these to Claude to fill in.');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
