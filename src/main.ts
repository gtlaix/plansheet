import './style.css';
import {
  fetchAllDatasets,
  fetchBorderGeojson,
  fetchEntityGeometry,
  queryEntities,
  queryEntitiesByGeometry,
  queryGeojson,
  queryGeojsonByGeometry,
} from './api/planningData';
import { reverseGeocode } from './api/geocode';
import { buildRegistry, scoreEntity, sortHits } from './datasets';
import {
  areaM2,
  center as geomCenter,
  decodeSite,
  encodeSite,
  formatArea,
  formatDistance,
  wktForQuery,
  type AreaGeometry,
} from './geometry';
import { computeCoverage } from './coverage';
import { scanProximity, siteFromPoint } from './proximity';
import { diffSnapshot, saveSite, type SavedSite } from './savedSites';
import { createMap, ENGLAND_BOUNDS } from './ui/map';
import { createSearchPanel } from './ui/search';
import { renderError, renderIdle, renderLoading, renderReport } from './ui/report';
import type { LocationSelection, RegistryEntry, ReportData, ScoredHit, SiteBoundary } from './types';

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

/** The last successful check — what a proximity scan (SPEC-04) scans around. */
let lastCheck: {
  token: number;
  data: ReportData;
  siteGeom: AreaGeometry;
  onSiteIds: Set<number>;
} | null = null;

function renderWithHandlers(data: ReportData): void {
  renderReport(reportRoot, data, {
    onUseAsBoundary: useTitleBoundary,
    onScan: runScan,
    onSave: saveCurrentSite,
    onToggleEntity: (ids, visible) => {
      for (const id of ids) map.setEntityVisible(id, visible);
    },
  });
}

/** Save the last check + a constraint snapshot for later re-checking. */
function saveCurrentSite(): void {
  const ctx = lastCheck;
  if (!ctx) return;
  const { data } = ctx;
  saveSite({
    label: data.selection.label ?? `${data.selection.lat.toFixed(5)}, ${data.selection.lng.toFixed(5)}`,
    location: data.site
      ? { kind: 'site', token: encodeSite(data.site.geojson) }
      : { kind: 'point', lat: data.selection.lat, lng: data.selection.lng },
    snapshot: data.hits
      .filter((h) => h.registry.category !== 'administrative')
      .map((h) => ({ entity: h.entity.entity, label: h.registry.label, name: String(h.entity.name ?? '').trim() })),
  });
  search.refreshSaved();
}

/** A re-check requested from the saved list: run it, then diff the snapshot. */
let pendingRecheck: SavedSite | null = null;

function recheckSaved(saved: SavedSite): void {
  pendingRecheck = saved;
  if (saved.location.kind === 'point') {
    void runCheck({ kind: 'point', lat: saved.location.lat, lng: saved.location.lng, label: saved.label });
  } else {
    const geom = decodeSite(saved.location.token);
    if (geom) void runCheck({ kind: 'polygon', geom, label: saved.label });
    else pendingRecheck = null;
  }
}

/** Run a proximity scan around the last check and fold it into the report. */
async function runScan(radiusM: number): Promise<void> {
  const ctx = lastCheck;
  if (!ctx || ctx.token !== runToken) return;
  try {
    const registry = await registryPromise;
    const scan = await scanProximity(ctx.siteGeom, radiusM, registry, ctx.onSiteIds, fetch, runAbort?.signal);
    if (ctx.token !== runToken) return; // a newer check superseded the scan
    ctx.data = { ...ctx.data, nearby: { radiusM, hits: scan.hits, skippedDense: scan.skippedDense } };
    renderWithHandlers(ctx.data);
    map.showProximity(
      scan.envelope,
      scan.hits.map((hit, i) => {
        const name = String(hit.entity.name ?? '').trim();
        return {
          feature: scan.features[i],
          score: hit.score,
          tooltip: `${hit.registry.label}${name ? `: ${name}` : ''} — ${formatDistance(hit.distanceM)} ${hit.bearing}`,
        };
      }),
    );
  } catch (err) {
    if (!runAbort?.signal.aborted) console.warn('plansheet: proximity scan failed', err);
    throw err; // the scan button resets via the rejected promise
  }
}

async function runCheck(input: CheckInput): Promise<void> {
  const token = ++runToken;
  runAbort?.abort(); // cancel the superseded run's in-flight requests (ISSUES-7)
  const abort = new AbortController();
  runAbort = abort;
  const diffAgainst = pendingRecheck; // consume a pending saved-site re-check
  pendingRecheck = null;

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
  map.clearProximity();
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

    const data: ReportData = {
      selection,
      site,
      nearestPostcode,
      hits: sorted,
      checked: registry,
      failedDatasets: result.failedDatasets,
      ...(diffAgainst
        ? {
            recheck: diffSnapshot(
              diffAgainst,
              sorted
                .filter((h) => h.registry.category !== 'administrative')
                .map((h) => ({ entity: h.entity.entity, label: h.registry.label, name: String(h.entity.name ?? '').trim() })),
            ),
          }
        : {}),
    };
    lastCheck = {
      token,
      data,
      siteGeom: site ? site.geojson : siteFromPoint(point.lat, point.lng),
      onSiteIds: new Set(sorted.map((h) => h.entity.entity)),
    };
    renderWithHandlers(data);
    search.collapse(label); // fold the search panel so results have room

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
    // Make every check shareable/bookmarkable: points as ?lat=&lng=, drawn or
    // imported boundaries as a compact ?site= token.
    if (site) {
      history.replaceState(null, '', `?site=${encodeSite(site.geojson)}`);
    } else {
      const params = new URLSearchParams({ lat: point.lat.toFixed(6), lng: point.lng.toFixed(6) });
      if (input.label) params.set('label', input.label);
      history.replaceState(null, '', `?${params.toString()}`);
    }

    const geojson = queryWkt
      ? await queryGeojsonByGeometry(queryWkt, overlaySlugs, fetch, abort.signal)
      : await queryGeojson(point.lat, point.lng, overlaySlugs, fetch, abort.signal);
    if (token === runToken && geojson) map.showOverlays(geojson, scoreBySlug, categoryBySlug);

    // Polygon checks: how much of the site does each constraint cover? (SPEC-02)
    if (token === runToken && geojson && site) {
      const coverage = await computeCoverage(site.geojson, geojson.features ?? []);
      if (token === runToken && coverage.size > 0 && lastCheck?.token === token) {
        const pctOnly = new Map([...coverage].map(([id, c]) => [id, c?.pct ?? 0]));
        const updated: ReportData = { ...data, hits: sortHits(sorted, pctOnly), coverage };
        lastCheck.data = updated;
        renderWithHandlers(updated);
      }
    }
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

/** Adopt an entity's geometry (e.g. an HM Land Registry title) as the site. */
async function useTitleBoundary(entityId: number): Promise<void> {
  const geom = await fetchEntityGeometry(entityId);
  if (geom) {
    void runCheck({ kind: 'polygon', geom, label: 'HM Land Registry title boundary' });
  } else {
    renderError(reportRoot, 'Could not load that title boundary as a site — try drawing or importing it instead.');
  }
}

const runBoundary = (geom: AreaGeometry, label?: string) => void runCheck({ kind: 'polygon', geom, label });
// Indirection so the map and panel can each reference the other despite creation order.
let onDrawChange: (drawing: boolean) => void = () => {};
const map = createMap(
  mapEl,
  (lat, lng) => void runCheck({ kind: 'point', lat, lng }),
  (geom) => runBoundary(geom),
  (drawing) => onDrawChange(drawing),
);
const search = createSearchPanel(
  searchRoot,
  (loc) => void runCheck({ kind: 'point', ...loc }),
  runBoundary,
  () => map.toggleDraw(),
  recheckSaved,
);
onDrawChange = (drawing) => search.setDrawing(drawing);
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

// Restore a shared link: ?site=… (drawn/imported boundary) or ?lat=…&lng=…[&label=…]
{
  const params = new URLSearchParams(location.search);
  const siteParam = params.get('site');
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  if (siteParam) {
    const geom = decodeSite(siteParam);
    if (geom) void runCheck({ kind: 'polygon', geom, label: 'Shared site boundary' });
  } else if (params.has('lat') && params.has('lng') && Number.isFinite(lat) && Number.isFinite(lng)) {
    void runCheck({ kind: 'point', lat, lng, label: params.get('label') ?? undefined });
  }
}
