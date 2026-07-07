import type { ApiDataset, DatasetResponse, EntityResponse, PlanningEntity } from '../types';

export const PLANNING_DATA_BASE = 'https://www.planning.data.gov.uk';

const DATASET_CACHE_KEY = 'plansheet-datasets-v1';
const DATASET_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Keep entity.json URLs a sane length by querying datasets in chunks. */
export const DATASETS_PER_REQUEST = 12;

interface DatasetCache {
  fetchedAt: number;
  datasets: ApiDataset[];
}

function readDatasetCache(): DatasetCache | null {
  try {
    const raw = localStorage.getItem(DATASET_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DatasetCache;
    if (!Array.isArray(parsed.datasets)) return null;
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
      localStorage.setItem(DATASET_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), datasets }));
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

export interface EntityQueryResult {
  entities: PlanningEntity[];
  /** Dataset slugs whose batch request failed (they could not be checked). */
  failedDatasets: string[];
}

/**
 * Return every entity whose geometry intersects the point, across all the
 * given datasets. Requests are batched and fired in parallel; a failed batch
 * is retried once, then reported via `failedDatasets` rather than throwing,
 * so one bad batch doesn't sink the whole report.
 */
export async function queryEntities(
  lat: number,
  lng: number,
  slugs: string[],
  fetchFn: typeof fetch = fetch,
): Promise<EntityQueryResult> {
  const batches = chunk(slugs, DATASETS_PER_REQUEST);
  const results = await Promise.all(
    batches.map(async (batch) => {
      const url = entityUrl('/entity.json', lat, lng, batch);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetchFn(url);
          if (!res.ok) throw new Error(`entity.json returned ${res.status}`);
          const body = (await res.json()) as EntityResponse;
          return { entities: body.entities ?? [], failed: [] as string[] };
        } catch (err) {
          if (attempt === 1) {
            console.warn('plansheet: entity query failed for', batch, err);
            return { entities: [] as PlanningEntity[], failed: batch };
          }
        }
      }
      return { entities: [] as PlanningEntity[], failed: batch };
    }),
  );

  return {
    entities: results.flatMap((r) => r.entities),
    failedDatasets: results.flatMap((r) => r.failed),
  };
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
): Promise<GeoJSON.FeatureCollection | null> {
  if (slugs.length === 0) return null;
  try {
    const collections = await Promise.all(
      chunk(slugs, DATASETS_PER_REQUEST).map(async (batch) => {
        const res = await fetchFn(entityUrl('/entity.geojson', lat, lng, batch));
        if (!res.ok) throw new Error(`entity.geojson returned ${res.status}`);
        return (await res.json()) as GeoJSON.FeatureCollection;
      }),
    );
    return {
      type: 'FeatureCollection',
      features: collections.flatMap((c) => c.features ?? []),
    };
  } catch (err) {
    console.warn('plansheet: geojson fetch failed (map overlay skipped)', err);
    return null;
  }
}

export function entityPageUrl(entityId: number): string {
  return `${PLANNING_DATA_BASE}/entity/${entityId}`;
}
