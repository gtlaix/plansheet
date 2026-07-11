/**
 * % of the site covered by each constraint (SPEC-02). Only meaningful for
 * polygon (site-boundary) checks and area-based constraint geometries.
 * `polygon-clipping` (the engine inside turf's intersect) is lazy-loaded so it
 * stays out of the main bundle for point checks.
 */
import { areaM2, type AreaGeometry } from './geometry';

export interface CoverageEntry {
  /** Percentage of the site area covered (0–100). */
  pct: number;
  /** Covered area in square metres. */
  areaM2: number;
}

/** entityId → coverage, or null when the geometry could not be intersected. */
export type CoverageByEntity = Map<number, CoverageEntry | null>;

type Ring = [number, number][];
type Poly = Ring[];
type MultiPoly = Poly[];

function toMulti(geom: AreaGeometry): MultiPoly {
  return (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates) as MultiPoly;
}

/**
 * Compute per-entity site coverage for area-based features. Point/line
 * features are skipped (coverage is meaningless for them); invalid geometries
 * yield `null` ("coverage n/a") rather than failing the report.
 */
export async function computeCoverage(
  site: AreaGeometry,
  features: GeoJSON.Feature[],
): Promise<CoverageByEntity> {
  const result: CoverageByEntity = new Map();
  const siteArea = areaM2(site);
  if (siteArea <= 0) return result;

  const { default: pc } = await import('polygon-clipping');
  const siteMulti = toMulti(site);

  for (const feature of features) {
    const entityId = Number(feature.properties?.entity);
    if (!Number.isFinite(entityId) || result.has(entityId)) continue;
    const geom = feature.geometry;
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
    try {
      const clipped = pc.intersection(siteMulti, toMulti(geom as AreaGeometry));
      const covered = clipped.reduce(
        (sum, poly) => sum + areaM2({ type: 'Polygon', coordinates: poly as GeoJSON.Position[][] }),
        0,
      );
      result.set(entityId, {
        areaM2: covered,
        pct: Math.min(100, (covered / siteArea) * 100),
      });
    } catch (err) {
      // Platform geometries are occasionally invalid (self-intersections);
      // "coverage n/a" beats a crashed report.
      console.warn('plansheet: coverage failed for entity', entityId, err);
      result.set(entityId, null);
    }
  }
  return result;
}

/** "≈ 18% of the site (912 m²)" / "coverage n/a". */
export function formatCoverage(entry: CoverageEntry | null): string {
  if (entry === null) return 'coverage n/a';
  const pct = entry.pct >= 99.5 ? '100' : entry.pct < 1 ? '<1' : String(Math.round(entry.pct));
  return `≈ ${pct}% of the site (${Math.round(entry.areaM2).toLocaleString('en-GB')} m²)`;
}
