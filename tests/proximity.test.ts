import { describe, expect, it, vi } from 'vitest';
import { buildRegistry } from '../src/datasets';
import { MAX_NEARBY_PER_DATASET, scanProximity, siteFromPoint } from '../src/proximity';

// Site: a point at SW1A 1AA. ~69,298 m per degree of longitude at this latitude.
const LAT = 51.501009;
const LNG = -0.141588;
const SITE = siteFromPoint(LAT, LNG);
const M_PER_DEG_LNG = 69298;

const registry = buildRegistry([]); // curated fallback registry

function polyAt(eastM: number, sizeM = 50): GeoJSON.Polygon {
  const w = LNG + eastM / M_PER_DEG_LNG;
  const e = w + sizeM / M_PER_DEG_LNG;
  return {
    type: 'Polygon',
    coordinates: [[[w, LAT - 0.0002], [e, LAT - 0.0002], [e, LAT + 0.0002], [w, LAT + 0.0002], [w, LAT - 0.0002]]],
  };
}

function feature(dataset: string, entity: number, geometry: GeoJSON.Geometry, name = ''): GeoJSON.Feature {
  return { type: 'Feature', properties: { dataset, entity, name, reference: `R${entity}` }, geometry };
}

function fetchReturning(features: GeoJSON.Feature[], urls: string[] = []) {
  return vi.fn(async (url: string) => {
    urls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ type: 'FeatureCollection', features }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('scanProximity', () => {
  it('keeps features within the radius with distance + bearing, drops the rest', async () => {
    const features = [
      feature('site-of-special-scientific-interest', 900, polyAt(200), 'Test SSSI'),
      feature('listed-building', 901, { type: 'Point', coordinates: [LNG + 900 / M_PER_DEG_LNG, LAT] }),
    ];
    const scan = await scanProximity(SITE, 500, registry, new Set(), fetchReturning(features));

    expect(scan.hits).toHaveLength(1); // the 900 m listed building is outside 500 m
    const hit = scan.hits[0];
    expect(hit.registry.slug).toBe('site-of-special-scientific-interest');
    expect(hit.distanceM).toBeGreaterThan(190);
    expect(hit.distanceM).toBeLessThan(210);
    expect(hit.bearing).toBe('E');
    expect(scan.features).toHaveLength(1);
  });

  it('excludes entities already on the site and administrative areas', async () => {
    const features = [
      feature('conservation-area', 555, polyAt(100)),
      feature('ward', 556, polyAt(100)),
    ];
    const scan = await scanProximity(SITE, 500, registry, new Set([555]), fetchReturning(features));
    expect(scan.hits).toHaveLength(0);
  });

  it('queries an envelope with intersects and skips dense datasets on wide scans', async () => {
    const urls: string[] = [];
    const scan = await scanProximity(SITE, 500, registry, new Set(), fetchReturning([], urls));
    expect(scan.skippedDense).toContain('transport-access-node');
    expect(scan.skippedDense).toContain('planning-application');
    const all = decodeURIComponent(urls.join(' ')).replace(/\+/g, ' ');
    expect(all).toContain('geometry=POLYGON');
    expect(all).toContain('geometry_relation=intersects');
    expect(all).not.toContain('dataset=transport-access-node');
    // administrative context is never scanned (title boundaries, wards…)
    expect(all).not.toContain('dataset=title-boundary');
    expect(all).not.toContain('dataset=ward');
  });

  it('includes dense datasets on narrow scans (≤ 250 m)', async () => {
    const urls: string[] = [];
    const scan = await scanProximity(SITE, 100, registry, new Set(), fetchReturning([], urls));
    expect(scan.skippedDense).toHaveLength(0);
    expect(decodeURIComponent(urls.join(' '))).toContain('dataset=transport-access-node');
  });

  it('caps each dataset at the nearest N and sorts by impact then distance', async () => {
    const trees = Array.from({ length: MAX_NEARBY_PER_DATASET + 10 }, (_, i) =>
      feature('tree', 2000 + i, { type: 'Point', coordinates: [LNG + (30 + i) / M_PER_DEG_LNG, LAT] }),
    );
    const sssi = feature('site-of-special-scientific-interest', 900, polyAt(400), 'Far SSSI');
    const scan = await scanProximity(SITE, 500, registry, new Set(), fetchReturning([...trees, sssi]));

    const treeHits = scan.hits.filter((h) => h.registry.slug === 'tree');
    expect(treeHits).toHaveLength(MAX_NEARBY_PER_DATASET);
    // nearest trees kept (the 10 farthest dropped)
    expect(Math.max(...treeHits.map((h) => h.distanceM))).toBeLessThan(30 + MAX_NEARBY_PER_DATASET + 2);
    // SSSI (impact 90) sorts above every tree (48) despite being farther away
    expect(scan.hits[0].registry.slug).toBe('site-of-special-scientific-interest');
  });
});
