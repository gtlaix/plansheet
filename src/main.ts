import './style.css';
import { fetchAllDatasets, queryEntities, queryGeojson } from './api/planningData';
import { reverseGeocode } from './api/geocode';
import { buildRegistry, scoreEntity, sortHits } from './datasets';
import { createMap, ENGLAND_BOUNDS } from './ui/map';
import { createSearchPanel } from './ui/search';
import { renderError, renderIdle, renderLoading, renderReport } from './ui/report';
import type { LocationSelection, RegistryEntry, ScoredHit } from './types';

const mapEl = document.getElementById('map')!;
const searchRoot = document.getElementById('search-root')!;
const reportRoot = document.getElementById('report-root')!;

const registryPromise: Promise<RegistryEntry[]> = fetchAllDatasets().then(buildRegistry);

// Admin datasets only exist for England — their absence is how we know a point
// (inside the bbox but in Wales/Scotland) is out of scope.
const ADMIN_SLUGS = ['region', 'local-authority-district', 'local-planning-authority'];

let runToken = 0;
let runAbort: AbortController | null = null;

async function runCheck(selection: LocationSelection): Promise<void> {
  const token = ++runToken;
  runAbort?.abort(); // cancel the superseded run's in-flight requests (ISSUES-7)
  const abort = new AbortController();
  runAbort = abort;
  const label = selection.label ?? `${selection.lat.toFixed(5)}, ${selection.lng.toFixed(5)}`;

  if (
    selection.lat < ENGLAND_BOUNDS.south ||
    selection.lat > ENGLAND_BOUNDS.north ||
    selection.lng < ENGLAND_BOUNDS.west ||
    selection.lng > ENGLAND_BOUNDS.east
  ) {
    renderError(reportRoot, 'That location is outside England — the Planning Data platform only covers England.');
    return;
  }

  map.setPin(selection.lat, selection.lng);
  map.clearOverlays();
  renderLoading(reportRoot, label);
  search.setBusy(true);

  try {
    const registry = await registryPromise;
    const bySlug = new Map(registry.map((r) => [r.slug, r]));

    const [result, nearestPostcode] = await Promise.all([
      queryEntities(selection.lat, selection.lng, registry.map((r) => r.slug), fetch, abort.signal),
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
    // Make the check shareable/bookmarkable (point checks only for now).
    const params = new URLSearchParams({ lat: selection.lat.toFixed(6), lng: selection.lng.toFixed(6) });
    if (selection.label) params.set('label', selection.label);
    history.replaceState(null, '', `?${params.toString()}`);

    const geojson = await queryGeojson(selection.lat, selection.lng, overlaySlugs, fetch, abort.signal);
    if (token === runToken && geojson) map.showOverlays(geojson, scoreBySlug);
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

const map = createMap(mapEl, (lat, lng) => void runCheck({ lat, lng }));
const search = createSearchPanel(searchRoot, (loc) => void runCheck(loc));
renderIdle(reportRoot);

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
    void runCheck({ lat, lng, label: params.get('label') ?? undefined });
  }
}
