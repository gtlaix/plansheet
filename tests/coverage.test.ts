import { describe, expect, it } from 'vitest';
import { computeCoverage, formatCoverage } from '../src/coverage';
import type { AreaGeometry } from '../src/geometry';

const SITE: AreaGeometry = {
  type: 'Polygon',
  coordinates: [[[0, 0], [0.002, 0], [0.002, 0.002], [0, 0.002], [0, 0]]],
};

function feat(entity: number, geometry: GeoJSON.Geometry): GeoJSON.Feature {
  return { type: 'Feature', properties: { entity, dataset: 'green-belt' }, geometry };
}

describe('computeCoverage', () => {
  it('computes a known 25% overlap within ±0.5', async () => {
    const quarter: GeoJSON.Geometry = {
      type: 'Polygon',
      coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]],
    };
    const cov = await computeCoverage(SITE, [feat(1, quarter)]);
    const entry = cov.get(1)!;
    expect(entry.pct).toBeGreaterThan(24.5);
    expect(entry.pct).toBeLessThan(25.5);
    expect(entry.areaM2).toBeGreaterThan(0);
  });

  it('caps a constraint larger than the site at 100%', async () => {
    const huge: GeoJSON.Geometry = {
      type: 'Polygon',
      coordinates: [[[-0.01, -0.01], [0.01, -0.01], [0.01, 0.01], [-0.01, 0.01], [-0.01, -0.01]]],
    };
    const cov = await computeCoverage(SITE, [feat(2, huge)]);
    expect(cov.get(2)!.pct).toBeCloseTo(100, 0);
  });

  it('skips point/line features and records null for broken geometry', async () => {
    const point: GeoJSON.Geometry = { type: 'Point', coordinates: [0.001, 0.001] };
    const broken = feat(4, { type: 'Polygon', coordinates: 'garbage' as unknown as GeoJSON.Position[][][] } as unknown as GeoJSON.Geometry);
    const cov = await computeCoverage(SITE, [feat(3, point), broken]);
    expect(cov.has(3)).toBe(false); // points have no meaningful coverage
    expect(cov.get(4)).toBeNull(); // "coverage n/a", not a crash
  });
});

describe('formatCoverage', () => {
  it('formats percentages, extremes and n/a', () => {
    expect(formatCoverage({ pct: 18.2, areaM2: 912.4 })).toBe('≈ 18% of the site (912 m²)');
    expect(formatCoverage({ pct: 0.4, areaM2: 3 })).toContain('<1%');
    expect(formatCoverage({ pct: 99.9, areaM2: 5000 })).toContain('100%');
    expect(formatCoverage(null)).toBe('coverage n/a');
  });
});
