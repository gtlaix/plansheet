import './style.css';
import {
  fetchAllDatasets,
  fetchBorderGeojson,
  queryEntities,
  queryEntitiesByGeometry,
  queryGeojson,
  queryGeojsonByGeometry,
} from './api/planningData';
import { reverseGeocode } from './api/geocode';
import { buildRegistry, scoreEntity, sortHits } from './datasets';
import { areaM2, center as geomCenter, formatArea, wktForQuery, type AreaGeometry } from './geometry';
import { createMap, ENGLAND_BOUNDS } from './ui/map';
import { createSearchPanel } from './ui/search';
import { renderError, renderIdle, renderLoading, renderReport } from './ui/report';
import type { LocationSelection, RegistryEntry, ScoredHit, SiteBoundary } from './types';

const mapEl = document.getElementById('map')!;
const searchRoot = document.getElementById('search-root')!;
const reportRoot = document.getElementById('report-root')!;

const registryPromise: Promise<RegistryEntry[]> = fetchAllDatasets().then(buildRegistry);

// Admin datasets only exist for England — their absence is how we know a point
// (inside the bbox but in Wales/Scotland) is out of scope.
const ADMIN_SLUGS = ['region', 'local-authority-district', 'local-planning-authority'];

/** A check is either a point (postcode/coords/BNG/click) or a site polygon. */
type CheckInput =
  | { kind: 'point'; lat: number; lng: number; label?: string }
  | { kind: 'polygon'; geom: AreaGeometry; label?: string };

let runToken = 0;
let runAbort: AbortController | null = null;

async function runCheck(input: CheckInput): Promise<void> {
  const token = ++runToken;
  runAbort?.abort(); // cancel the superseded run's in-flight requests (ISSUES-7)
  const abort = new AbortController();
  runAbort = abort;

  // Resolve a representative point (for the pin, nearest postcode, share link)
  // and, for polygons, the site geometry + area.
  const site: SiteBoundary | undefined =
    input.kind === 'polygon' ? { geojson: input.geom, areaM2: areaM2(input.geom) } : undefined;
  const point = input.kind === 'point' ? { lat: input.lat, lng: input.lng } : geomCenter(input.geom);
  const label =
    input.label ??
    (site ? `Site boundary — ${formatArea(site.areaM2)}` : `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`);
  const selection: LocationSelection = { lat: point.lat, lng: point.lng, label };

  if (
    point.lat < ENGLAND_BOUNDS.south ||
    point.lat > ENGLAND_BOUNDS.north ||
    point.lng < ENGLAND_BOUNDS.west ||
    point.lng > ENGLAND_BOUNDS.east
  ) {
    renderError(reportRoot, 'That location is outside England — the Planning Data platform only covers England.');
    return;
  }

  if (site) map.showBoundary(site.geojson);
  else map.setPin(point.lat, point.lng);
  map.clearOverlays();
  renderLoading(reportRoot, label);
  search.setBusy(true);

  // For polygon checks, one simplified WKT is shared across every batch/overlay.
  const queryWkt = site ? wktForQuery(site.geojson) : null;

  try {
    const registry = await registryPromise;
    const bySlug = new Map(registry.map((r) => [r.slug, r]));
    const slugs = registry.map((r) => r.slug);

    const [result, nearestPostcode] = await Promise.all([
      queryWkt
        ? queryEntitiesByGeometry(queryWkt, slugs, fetch, abort.signal)
        : queryEntities(point.lat, point.lng, slugs, fetch, abort.signal),
      reverseGeocode(point.lat, point.lng),
    ]);
    if (token !== runToken) return; // a newer check superseded this one

    const hits: ScoredHit[] = result.entities
      .map((entity) => {
        const reg = bySlug.get(entity.dataset);
        return reg ? scoreEntity(entity, reg) : null;
      })
      .filter((h): h is ScoredHit => h !== null);
    const sorted = sortHits(hits);

    // Inside the bbox but no administrative area = not in England (Wales/Scotland
    // or offshore). Only trust this when the admin queries actually succeeded.
    const hasAdmin = sorted.some((h) => h.registry.category === 'administrative');
    const adminQueryOk = ADMIN_SLUGS.some((s) => !result.failedDatasets.includes(s));
    if (!hasAdmin && adminQueryOk) {
      map.clearOverlays();
      renderError(reportRoot, 'This location is not in England — the Planning Data platform only covers England.');
      return;
    }

    renderReport(reportRoot, {
      selection,
      site,
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
    const categoryBySlug = new Map<string, RegistryEntry['category']>();
    for (const hit of sorted) {
      scoreBySlug.set(hit.registry.slug, Math.max(scoreBySlug.get(hit.registry.slug) ?? 0, hit.score));
      categoryBySlug.set(hit.registry.slug, hit.registry.category);
    }
    // Make point checks shareable/bookmarkable. Polygon boundaries aren't URL-
    // encoded yet (a BACKLOG item), so drop any stale ?lat= from a prior check.
    if (queryWkt) {
      history.replaceState(null, '', location.pathname);
    } else {
      const params = new URLSearchParams({ lat: point.lat.toFixed(6), lng: point.lng.toFixed(6) });
      if (input.label) params.set('label', input.label);
      history.replaceState(null, '', `?${params.toString()}`);
    }

    const geojson = queryWkt
      ? await queryGeojsonByGeometry(queryWkt, overlaySlugs, fetch, abort.signal)
      : await queryGeojson(point.lat, point.lng, overlaySlugs, fetch, abort.signal);
    if (token === runToken && geojson) map.showOverlays(geojson, scoreBySlug, categoryBySlug);
  } catch (err) {
    if (abort.signal.aborted) return; // superseded — the newer run owns the UI
    console.error('plansheet: check failed', err);
    if (token === runToken) {
      renderError(reportRoot, 'Could not reach the Planning Data API — check your connection and try again.');
    }
  } finally {
    if (token === runToken) search.setBusy(false);
  }
}

const map = createMap(mapEl, (lat, lng) => void runCheck({ kind: 'point', lat, lng }));
const search = createSearchPanel(
  searchRoot,
  (loc) => void runCheck({ kind: 'point', ...loc }),
  (geom, label) => void runCheck({ kind: 'polygon', geom, label }),
);
renderIdle(reportRoot);

// Grey out everything outside England using the ONS `border` layer (best-effort).
void fetchBorderGeojson().then((border) => map.showEnglandMask(border));

// --- Dark mode: persisted, defaulting to the OS preference ---
const THEME_KEY = 'plansheet-theme';
const themeToggle = document.getElementById('theme-toggle');
type Theme = 'light' | 'dark';

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  map.setDark(theme === 'dark');
  if (themeToggle) {
    themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
    themeToggle.textContent = theme === 'dark' ? '☀ Light' : '☾ Dark';
  }
}

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // storage unavailable
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let theme = initialTheme();
applyTheme(theme);
themeToggle?.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // storage unavailable — choice just won't persist
  }
  applyTheme(theme);
});

// Print the full record: expand collapsed sections for printing (ISSUES-4).
const detailsState = new WeakMap<HTMLDetailsElement, boolean>();
window.addEventListener('beforeprint', () => {
  for (const d of document.querySelectorAll('details')) {
    detailsState.set(d, d.open);
    d.open = true;
  }
});
window.addEventListener('afterprint', () => {
  for (const d of document.querySelectorAll('details')) {
    if (detailsState.has(d)) d.open = detailsState.get(d)!;
  }
});

// Restore a shared link: ?lat=…&lng=…[&label=…]
{
  const params = new URLSearchParams(location.search);
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  if (params.has('lat') && params.has('lng') && Number.isFinite(lat) && Number.isFinite(lng)) {
    void runCheck({ kind: 'point', lat, lng, label: params.get('label') ?? undefined });
  }
}
