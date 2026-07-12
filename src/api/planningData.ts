import type { ApiDataset, DatasetResponse, EntityResponse, PlanningEntity } from '../types';

export const PLANNING_DATA_BASE = 'https://www.planning.data.gov.uk';

const DATASET_CACHE_KEY = 'plansheet-datasets-v1';
const DATASET_CACHE_SCHEMA = 1;
const DATASET_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Keep entity.json URLs a sane length by querying datasets in chunks. */
export const DATASETS_PER_REQUEST = 12;

/** Safety cap when following pagination links (500 entities/page). */
export const MAX_PAGES_PER_BATCH = 10;

interface DatasetCache {
  schemaVersion: number;
  fetchedAt: number;
  datasets: ApiDataset[];
}

function readDatasetCache(): DatasetCache | null {
  try {
    const raw = localStorage.getItem(DATASET_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DatasetCache;
    if (parsed.schemaVersion !== DATASET_CACHE_SCHEMA || !Array.isArray(parsed.datasets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Fetch the full dataset list, cached in localStorage for 24h. On network
 * failure any stale cache is used; failing that an empty list is returned and
 * the registry falls back to its curated slugs.
 */
export async function fetchAllDatasets(fetchFn: typeof fetch = fetch): Promise<ApiDataset[]> {
  const cache = readDatasetCache();
  if (cache && Date.now() - cache.fetchedAt < DATASET_CACHE_TTL_MS) {
    return cache.datasets;
  }
  try {
    const res = await fetchFn(`${PLANNING_DATA_BASE}/dataset.json`);
    if (!res.ok) throw new Error(`dataset.json returned ${res.status}`);
    const body = (await res.json()) as DatasetResponse;
    const datasets = body.datasets ?? [];
    try {
      localStorage.setItem(
        DATASET_CACHE_KEY,
        JSON.stringify({ schemaVersion: DATASET_CACHE_SCHEMA, fetchedAt: Date.now(), datasets }),
      );
    } catch {
      // localStorage full/unavailable — caching is best-effort
    }
    return datasets;
  } catch (err) {
    console.warn('plansheet: could not fetch dataset list, using fallback', err);
    return cache?.datasets ?? [];
  }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function entityUrl(path: string, lat: number, lng: number, slugs: string[]): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    limit: '500',
  });
  for (const slug of slugs) params.append('dataset', slug);
  return `${PLANNING_DATA_BASE}${path}?${params.toString()}`;
}

/**
 * Build a geometry-query URL: entities whose geometry intersects the given WKT.
 * Used by the polygon (site-boundary) flow — SPEC-01. `geometry_relation`
 * defaults to `intersects` so an edge-clipping constraint is included.
 */
function geometryUrl(path: string, wkt: string, slugs: string[]): string {
  const params = new URLSearchParams({
    geometry: wkt,
    geometry_relation: 'intersects',
    limit: '500',
  });
  for (const slug of slugs) params.append('dataset', slug);
  return `${PLANNING_DATA_BASE}${path}?${params.toString()}`;
}

export interface EntityQueryResult {
  entities: PlanningEntity[];
  /** Dataset slugs whose batch request failed (they could not be checked). */
  failedDatasets: string[];
}

/** Fetch one entity.json page with a single retry; throws after the retry fails. */
async function fetchEntityPage(url: string, fetchFn: typeof fetch, signal?: AbortSignal): Promise<EntityResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchFn(url, { signal });
      if (!res.ok) throw new Error(`entity.json returned ${res.status}`);
      return (await res.json()) as EntityResponse;
    } catch (err) {
      if (signal?.aborted || attempt === 1) throw err;
    }
  }
}

/**
 * Fetch every page of one batch, following `links.next` to the pagination cap.
 * A failed batch (after one retry inside `fetchEntityPage`) is reported via
 * `failed` rather than thrown, so one bad batch doesn't sink the whole report.
 */
async function collectBatch(
  firstUrl: string,
  batch: string[],
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<{ entities: PlanningEntity[]; failed: string[] }> {
  try {
    const entities: PlanningEntity[] = [];
    let url: string | undefined = firstUrl;
    for (let page = 0; url && page < MAX_PAGES_PER_BATCH; page++) {
      const body = await fetchEntityPage(url, fetchFn, signal);
      entities.push(...(body.entities ?? []));
      url = body.links?.next || undefined;
      if (url && page === MAX_PAGES_PER_BATCH - 1) {
        console.warn('plansheet: pagination cap reached for', batch);
      }
    }
    return { entities, failed: [] };
  } catch (err) {
    if (!signal?.aborted) console.warn('plansheet: entity query failed for', batch, err);
    return { entities: [], failed: batch };
  }
}

async function runBatches(
  slugs: string[],
  buildFirstUrl: (batch: string[]) => string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<EntityQueryResult> {
  const results = await Promise.all(
    chunk(slugs, DATASETS_PER_REQUEST).map((batch) => collectBatch(buildFirstUrl(batch), batch, fetchFn, signal)),
  );
  // Batches are disjoint by dataset, but pagination pages can overlap when the
  // underlying data shifts mid-walk — dedupe by entity id for safety.
  const seen = new Set<number>();
  const entities = results
    .flatMap((r) => r.entities)
    .filter((e) => {
      if (seen.has(e.entity)) return false;
      seen.add(e.entity);
      return true;
    });
  return {
    entities,
    failedDatasets: results.flatMap((r) => r.failed),
  };
}

/**
 * Return every entity whose geometry intersects the point, across all the
 * given datasets. Requests are batched and fired in parallel, and pagination
 * links are followed (the API pages at 500 entities).
 */
export async function queryEntities(
  lat: number,
  lng: number,
  slugs: string[],
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<EntityQueryResult> {
  return runBatches(slugs, (batch) => entityUrl('/entity.json', lat, lng, batch), fetchFn, signal);
}

/**
 * Return every entity whose geometry intersects the given WKT polygon, across
 * all the given datasets — the site-boundary flow (SPEC-01). This catches
 * constraints that clip the edge of a site, which a centroid point query
 * would miss. Same batching, pagination and per-batch failure handling.
 */
export async function queryEntitiesByGeometry(
  wkt: string,
  slugs: string[],
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<EntityQueryResult> {
  return runBatches(slugs, (batch) => geometryUrl('/entity.json', wkt, batch), fetchFn, signal);
}

/**
 * Fetch GeoJSON geometries for map overlay. Only called for datasets that
 * actually had hits, so this is a single small request in practice.
 */
export async function queryGeojson(
  lat: number,
  lng: number,
  slugs: string[],
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<GeoJSON.FeatureCollection | null> {
  return collectGeojson(slugs, (batch) => entityUrl('/entity.geojson', lat, lng, batch), fetchFn, signal);
}

/** GeoJSON overlay geometries intersecting a WKT polygon (site-boundary flow). */
export async function queryGeojsonByGeometry(
  wkt: string,
  slugs: string[],
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<GeoJSON.FeatureCollection | null> {
  return collectGeojson(slugs, (batch) => geometryUrl('/entity.geojson', wkt, batch), fetchFn, signal);
}

/**
 * entity.geojson pages at 500 features and carries no `links` — verified live
 * 2026-07-12 (a 2 km central-London envelope held 3,886 listed buildings but
 * one response returned 500). Pages are walked via `offset` up to this cap.
 */
export const GEOJSON_MAX_PAGES = 6;
const GEOJSON_PAGE_SIZE = 500;

async function collectGeojson(
  slugs: string[],
  buildUrl: (batch: string[]) => string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<GeoJSON.FeatureCollection | null> {
  if (slugs.length === 0) return null;
  try {
    const collections = await Promise.all(
      chunk(slugs, DATASETS_PER_REQUEST).map(async (batch) => {
        const features: GeoJSON.Feature[] = [];
        let prevFirstId: unknown;
        for (let page = 0; page < GEOJSON_MAX_PAGES; page++) {
          const offset = page * GEOJSON_PAGE_SIZE;
          const url = buildUrl(batch) + (offset > 0 ? `&offset=${offset}` : '');
          const res = await fetchFn(url, { signal });
          if (!res.ok) throw new Error(`entity.geojson returned ${res.status}`);
          const fc = (await res.json()) as GeoJSON.FeatureCollection;
          const pageFeatures = fc.features ?? [];
          // If the server ignored `offset` it would replay page 1 — stop
          // rather than duplicate forever.
          const firstId = pageFeatures[0]?.properties?.entity;
          if (page > 0 && firstId !== undefined && firstId === prevFirstId) break;
          prevFirstId = firstId;
          features.push(...pageFeatures);
          if (pageFeatures.length < GEOJSON_PAGE_SIZE) break;
          if (page === GEOJSON_MAX_PAGES - 1) {
            console.warn('plansheet: geojson pagination cap reached for', batch);
          }
        }
        return features;
      }),
    );
    return {
      type: 'FeatureCollection',
      features: collections.flat(),
    };
  } catch (err) {
    console.warn('plansheet: geojson fetch failed (map overlay skipped)', err);
    return null;
  }
}

export function entityPageUrl(entityId: number): string {
  return `${PLANNING_DATA_BASE}/entity/${entityId}`;
}

/**
 * Fetch a single entity's geometry as GeoJSON (`/entity/{id}.geojson`) — used to
 * adopt an HM Land Registry title boundary as the site polygon (SPEC-01, story
 * 2). Returns null (best-effort) if the entity has no Polygon/MultiPolygon.
 */
export async function fetchEntityGeometry(
  entityId: number,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<GeoJSON.Polygon | GeoJSON.MultiPolygon | null> {
  try {
    const res = await fetchFn(`${PLANNING_DATA_BASE}/entity/${entityId}.geojson`, { signal });
    if (!res.ok) throw new Error(`entity geojson returned ${res.status}`);
    const body = (await res.json()) as GeoJSON.Feature | GeoJSON.FeatureCollection | GeoJSON.Geometry;
    const geom =
      body.type === 'FeatureCollection'
        ? body.features[0]?.geometry
        : body.type === 'Feature'
          ? body.geometry
          : body;
    if (geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) return geom;
    return null;
  } catch (err) {
    console.warn('plansheet: could not fetch entity geometry', entityId, err);
    return null;
  }
}

const BORDER_CACHE_KEY = 'plansheet-border-v1';
const BORDER_CACHE_SCHEMA = 1;

interface BorderCache {
  schemaVersion: number;
  geojson: GeoJSON.FeatureCollection;
}

/**
 * Fetch the ONS England outline (`border` dataset) as GeoJSON for the map mask,
 * cached indefinitely in localStorage (national boundaries barely change).
 * Best-effort: returns null on any failure so the map still works without it.
 */
export async function fetchBorderGeojson(fetchFn: typeof fetch = fetch): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const raw = localStorage.getItem(BORDER_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as BorderCache;
      if (parsed.schemaVersion === BORDER_CACHE_SCHEMA && parsed.geojson?.features?.length) {
        return parsed.geojson;
      }
    }
  } catch {
    // fall through to a fresh fetch
  }
  try {
    const res = await fetchFn(`${PLANNING_DATA_BASE}/entity.geojson?dataset=border&limit=10`);
    if (!res.ok) throw new Error(`border geojson returned ${res.status}`);
    const geojson = (await res.json()) as GeoJSON.FeatureCollection;
    if (!geojson.features?.length) return null;
    try {
      localStorage.setItem(BORDER_CACHE_KEY, JSON.stringify({ schemaVersion: BORDER_CACHE_SCHEMA, geojson }));
    } catch {
      // caching is best-effort
    }
    return geojson;
  } catch (err) {
    console.warn('plansheet: could not fetch England border (mask skipped)', err);
    return null;
  }
}
