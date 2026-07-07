import './style.css';
import { fetchAllDatasets, queryEntities, queryGeojson } from './api/planningData';
import { reverseGeocode } from './api/geocode';
import { buildRegistry, scoreEntity, sortHits } from './datasets';
import { createMap } from './ui/map';
import { createSearchPanel } from './ui/search';
import { renderError, renderIdle, renderLoading, renderReport } from './ui/report';
import type { LocationSelection, RegistryEntry, ScoredHit } from './types';

const mapEl = document.getElementById('map')!;
const searchRoot = document.getElementById('search-root')!;
const reportRoot = document.getElementById('report-root')!;

const registryPromise: Promise<RegistryEntry[]> = fetchAllDatasets().then(buildRegistry);

let runToken = 0;

async function runCheck(selection: LocationSelection): Promise<void> {
  const token = ++runToken;
  const label = selection.label ?? `${selection.lat.toFixed(5)}, ${selection.lng.toFixed(5)}`;

  map.setPin(selection.lat, selection.lng);
  map.clearOverlays();
  renderLoading(reportRoot, label);
  search.setBusy(true);

  try {
    const registry = await registryPromise;
    const bySlug = new Map(registry.map((r) => [r.slug, r]));

    const [result, nearestPostcode] = await Promise.all([
      queryEntities(selection.lat, selection.lng, registry.map((r) => r.slug)),
      reverseGeocode(selection.lat, selection.lng),
    ]);
    if (token !== runToken) return; // a newer check superseded this one

    const hits: ScoredHit[] = result.entities
      .map((entity) => {
        const reg = bySlug.get(entity.dataset);
        return reg ? scoreEntity(entity, reg) : null;
      })
      .filter((h): h is ScoredHit => h !== null);
    const sorted = sortHits(hits);

    renderReport(reportRoot, {
      selection,
      nearestPostcode,
      hits: sorted,
      checked: registry,
      failedDatasets: result.failedDatasets,
    });

    // Overlay geometries for constraint hits only (admin boundaries are noise).
    const overlaySlugs = [
      ...new Set(sorted.filter((h) => h.registry.category !== 'administrative').map((h) => h.registry.slug)),
    ];
    const scoreBySlug = new Map<string, number>();
    for (const hit of sorted) {
      scoreBySlug.set(hit.registry.slug, Math.max(scoreBySlug.get(hit.registry.slug) ?? 0, hit.score));
    }
    const geojson = await queryGeojson(selection.lat, selection.lng, overlaySlugs);
    if (token === runToken && geojson) map.showOverlays(geojson, scoreBySlug);
  } catch (err) {
    console.error('plansheet: check failed', err);
    if (token === runToken) {
      renderError(reportRoot, 'Could not reach the Planning Data API — check your connection and try again.');
    }
  } finally {
    if (token === runToken) search.setBusy(false);
  }
}

const map = createMap(mapEl, (lat, lng) => void runCheck({ lat, lng }));
const search = createSearchPanel(searchRoot, (loc) => void runCheck(loc));
renderIdle(reportRoot);
