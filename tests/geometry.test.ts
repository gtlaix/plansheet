import { describe, expect, it } from 'vitest';
import {
  areaM2,
  bbox,
  BoundaryError,
  center,
  formatArea,
  MAX_QUERY_WKT_CHARS,
  parseBoundary,
  toWkt,
  wktForQuery,
  type AreaGeometry,
} from '../src/geometry';

const SQUARE: AreaGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-0.143, 51.5],
      [-0.14, 51.5],
      [-0.14, 51.502],
      [-0.143, 51.502],
      [-0.143, 51.5],
    ],
  ],
};

/** A many-vertex circle: used to check simplification fits the query budget. */
function circle(cx: number, cy: number, r: number, n: number): AreaGeometry {
  const ring: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

describe('toWkt', () => {
  it('serialises a Polygon with rounded coordinates', () => {
    expect(toWkt(SQUARE)).toBe(
      'POLYGON ((-0.143 51.5, -0.14 51.5, -0.14 51.502, -0.143 51.502, -0.143 51.5))',
    );
  });

  it('serialises a MultiPolygon', () => {
    const multi: AreaGeometry = { type: 'MultiPolygon', coordinates: [SQUARE.coordinates as GeoJSON.Position[][]] };
    expect(toWkt(multi)).toBe(
      'MULTIPOLYGON (((-0.143 51.5, -0.14 51.5, -0.14 51.502, -0.143 51.502, -0.143 51.5)))',
    );
  });

  it('rounds to 6 decimal places', () => {
    const g: AreaGeometry = {
      type: 'Polygon',
      coordinates: [[[-0.1234567891, 51.5], [-0.14, 51.5], [-0.14, 51.502], [-0.1234567891, 51.5]]],
    };
    expect(toWkt(g)).toContain('-0.123457 51.5');
  });
});

describe('areaM2', () => {
  it('matches the spherical area of a 0.01°×0.01° box at the equator', () => {
    const g: AreaGeometry = {
      type: 'Polygon',
      coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]],
    };
    // 0.01° ≈ 1113 m; area ≈ 1.239e6 m².
    expect(areaM2(g)).toBeGreaterThan(1.235e6);
    expect(areaM2(g)).toBeLessThan(1.243e6);
  });

  it('subtracts interior rings (holes)', () => {
    const withHole: AreaGeometry = {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]],
        [[0.002, 0.002], [0.008, 0.002], [0.008, 0.008], [0.002, 0.008], [0.002, 0.002]],
      ],
    };
    const solid = areaM2({ type: 'Polygon', coordinates: [withHole.coordinates[0]] });
    expect(areaM2(withHole)).toBeLessThan(solid);
    expect(areaM2(withHole)).toBeGreaterThan(0);
  });

  it('sums polygons of a MultiPolygon', () => {
    const one = SQUARE.coordinates as GeoJSON.Position[][];
    const single = areaM2(SQUARE);
    const multi: AreaGeometry = { type: 'MultiPolygon', coordinates: [one, one] };
    expect(areaM2(multi)).toBeCloseTo(single * 2, 0);
  });
});

describe('formatArea', () => {
  it('shows m² and hectares', () => {
    expect(formatArea(12345)).toBe('12,345 m² (1.23 ha)');
  });
});

describe('bbox & center', () => {
  it('computes the bounding box and its centre', () => {
    expect(bbox(SQUARE)).toEqual([-0.143, 51.5, -0.14, 51.502]);
    expect(center(SQUARE).lat).toBeCloseTo(51.501, 6);
    expect(center(SQUARE).lng).toBeCloseTo(-0.1415, 6);
  });
});

describe('wktForQuery', () => {
  it('returns full-precision WKT when it already fits', () => {
    expect(wktForQuery(SQUARE)).toBe(toWkt(SQUARE));
  });

  it('simplifies a 500-vertex polygon under the query-length budget', () => {
    const big = circle(-0.14, 51.5, 0.005, 500);
    expect(toWkt(big).length).toBeGreaterThan(MAX_QUERY_WKT_CHARS); // original is too long
    const wkt = wktForQuery(big);
    expect(wkt.length).toBeLessThanOrEqual(MAX_QUERY_WKT_CHARS);
    // far fewer vertices in the query than the original 500
    expect(wkt.split(',').length).toBeLessThan(500);
    // …but the original geometry is untouched (still 501 positions)
    expect((big.coordinates[0] as unknown[]).length).toBe(501);
  });

  it('keeps the simplified boundary close in area to the original', () => {
    const big = circle(-0.14, 51.5, 0.005, 500);
    const original = areaM2(big);
    // reparse the simplified query WKT and compare area
    const simplified = parseBoundary(wktForQuery(big));
    expect(areaM2(simplified)).toBeGreaterThan(original * 0.97);
    expect(areaM2(simplified)).toBeLessThan(original * 1.03);
  });
});

describe('parseBoundary', () => {
  const wkt = 'POLYGON ((-0.143 51.5, -0.14 51.5, -0.14 51.502, -0.143 51.502, -0.143 51.5))';

  it('parses a WKT POLYGON', () => {
    const g = parseBoundary(wkt);
    expect(g.type).toBe('Polygon');
    expect(g.coordinates[0]).toHaveLength(5);
    expect(g.coordinates[0][0]).toEqual([-0.143, 51.5]);
  });

  it('parses a WKT MULTIPOLYGON with two polygons', () => {
    const g = parseBoundary(
      'MULTIPOLYGON (((-0.143 51.5, -0.14 51.5, -0.14 51.502, -0.143 51.5)), ((-0.13 51.5, -0.12 51.5, -0.12 51.51, -0.13 51.5)))',
    );
    expect(g.type).toBe('MultiPolygon');
    expect((g as GeoJSON.MultiPolygon).coordinates).toHaveLength(2);
  });

  it('parses a WKT polygon with a hole', () => {
    const g = parseBoundary(
      'POLYGON ((0 51, 0.02 51, 0.02 51.02, 0 51.02, 0 51), (0.005 51.005, 0.015 51.005, 0.015 51.015, 0.005 51.005))',
    );
    expect(g.type).toBe('Polygon');
    expect(g.coordinates).toHaveLength(2);
  });

  it('parses a GeoJSON geometry, Feature and FeatureCollection', () => {
    const geom = { type: 'Polygon', coordinates: SQUARE.coordinates };
    expect(parseBoundary(JSON.stringify(geom)).type).toBe('Polygon');
    expect(parseBoundary(JSON.stringify({ type: 'Feature', properties: {}, geometry: geom })).type).toBe('Polygon');
    expect(
      parseBoundary(
        JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: geom }] }),
      ).type,
    ).toBe('Polygon');
  });

  it('closes an unclosed ring', () => {
    const g = parseBoundary('POLYGON ((-0.143 51.5, -0.14 51.5, -0.14 51.502, -0.143 51.502))');
    const ring = g.coordinates[0] as GeoJSON.Position[];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring).toHaveLength(5);
  });

  it('rejects easting/northing (EPSG:27700) coordinates with a helpful message', () => {
    // A box in metres around Trafalgar Square.
    const bng = 'POLYGON ((529000 179000, 530000 179000, 530000 180000, 529000 180000, 529000 179000))';
    expect(() => parseBoundary(bng)).toThrow(BoundaryError);
    expect(() => parseBoundary(bng)).toThrow(/EPSG:27700/);
  });

  it('rejects a boundary outside England', () => {
    const paris = 'POLYGON ((2.3 48.85, 2.35 48.85, 2.35 48.87, 2.3 48.87, 2.3 48.85))';
    expect(() => parseBoundary(paris)).toThrow(/outside England/);
  });

  it('rejects too few points and empty input', () => {
    expect(() => parseBoundary('POLYGON ((-0.14 51.5, -0.13 51.5, -0.14 51.5))')).toThrow(/at least 3/);
    expect(() => parseBoundary('   ')).toThrow(/Paste a boundary/);
    expect(() => parseBoundary('not geometry at all')).toThrow(BoundaryError);
  });
});
