/**
 * Proximity scan (SPEC-04): "what is within X metres of my site, and how far?"
 *
 * Approach: query the API with a simple *envelope* (the site bbox expanded by
 * the radius) via `geometry_relation=intersects`, then compute the exact
 * boundary-to-boundary distance to every returned feature and keep those
 * within the radius. This avoids buffering polygons (hard to do robustly) and
 * keeps the distance honest — the envelope is only ever a superset.
 */
import { queryGeojsonByGeometry } from './api/planningData';
import { scoreEntity } from './datasets';
import {
  center,
  compassBearing,
  envelopeForRadius,
  minDistanceMeters,
  wktForQuery,
  type AreaGeometry,
} from './geometry';
import type { NearbyHit, PlanningEntity, RegistryEntry } from './types';

export const RADIUS_PRESETS_M = [50, 100, 250, 500, 1000, 2000];
export const DEFAULT_RADIUS_M = 500;

/** Show at most this many nearby features per dataset (nearest first). */
export const MAX_NEARBY_PER_DATASET = 50;

/**
 * Datasets skipped on wider scans (> 250 m): transport nodes blanket urban
 * areas, and planning applications are history rather than designations — they
 * would drown the genuinely useful nearby constraints. (Registered titles are
 * never scanned at all: `title-boundary` is administrative context.)
 */
export const DENSE_SLUGS_WIDE_SCAN = new Set(['transport-access-node', 'planning-application']);

export interface ProximityScan {
  radiusM: number;
  hits: NearbyHit[];
  /** The envelope actually sent to the API, for rendering the scan area. */
  envelope: AreaGeometry;
  /** Kept features (subset of the response), keyed off hits for the map. */
  features: GeoJSON.Feature[];
  /** Dataset slugs skipped because the radius exceeded the dense-data guard. */
  skippedDense: string[];
}

/** A point check has no polygon — scan around a tiny square at the point. */
export function siteFromPoint(lat: number, lng: number): AreaGeometry {
  const d = 0.000005; // ~0.5 m
  return {
    type: 'Polygon',
    coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]],
  };
}

/**
 * Scan for constraints within `radiusM` of the site. `onSiteEntityIds` are the
 * entities already reported as intersecting — they are never "nearby".
 */
export async function scanProximity(
  site: AreaGeometry,
  radiusM: number,
  registry: RegistryEntry[],
  onSiteEntityIds: Set<number>,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ProximityScan> {
  const skippedDense: string[] = [];
  const bySlug = new Map(registry.map((r) => [r.slug, r]));
  const slugs = registry
    .filter((r) => {
      if (r.category === 'administrative') return false; // admin areas surround everything
      if (radiusM > 250 && DENSE_SLUGS_WIDE_SCAN.has(r.slug)) {
        skippedDense.push(r.slug);
        return false;
      }
      return true;
    })
    .map((r) => r.slug);

  const envelope = envelopeForRadius(site, radiusM);
  const fc = await queryGeojsonByGeometry(wktForQuery(envelope), slugs, fetchFn, signal);
  if (!fc) throw new Error('proximity scan failed: no response');

  const siteCentre = center(site);
  const candidates: { hit: NearbyHit; feature: GeoJSON.Feature }[] = [];
  const seen = new Set<number>(); // batches/pages can overlap — dedupe by entity
  for (const feature of fc.features ?? []) {
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const entityId = Number(props.entity);
    const slug = String(props.dataset ?? '');
    const reg = bySlug.get(slug);
    if (!reg || reg.category === 'administrative' || !feature.geometry) continue;
    if (Number.isFinite(entityId)) {
      if (onSiteEntityIds.has(entityId) || seen.has(entityId)) continue;
      seen.add(entityId);
    }

    const { distanceM, nearest } = minDistanceMeters(site, feature.geometry);
    if (distanceM > radiusM) continue;

    const scored = scoreEntity(props as unknown as PlanningEntity, reg);
    candidates.push({
      hit: { ...scored, distanceM, bearing: compassBearing(siteCentre, nearest) },
      feature,
    });
  }

  // Nearest-first per dataset, capped, then impact-desc / distance-asc overall.
  const byDataset = new Map<string, { hit: NearbyHit; feature: GeoJSON.Feature }[]>();
  for (const c of candidates) {
    const list = byDataset.get(c.hit.registry.slug) ?? [];
    list.push(c);
    byDataset.set(c.hit.registry.slug, list);
  }
  const kept: { hit: NearbyHit; feature: GeoJSON.Feature }[] = [];
  for (const list of byDataset.values()) {
    list.sort((a, b) => a.hit.distanceM - b.hit.distanceM);
    kept.push(...list.slice(0, MAX_NEARBY_PER_DATASET));
  }
  kept.sort((a, b) => {
    if (a.hit.score !== b.hit.score) return b.hit.score - a.hit.score;
    return a.hit.distanceM - b.hit.distanceM;
  });

  return {
    radiusM,
    hits: kept.map((k) => k.hit),
    envelope,
    features: kept.map((k) => k.feature),
    skippedDense,
  };
}
