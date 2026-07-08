import { describe, expect, it, vi } from 'vitest';
import {
  chunk,
  DATASETS_PER_REQUEST,
  entityPageUrl,
  fetchAllDatasets,
  fetchEntityGeometry,
  queryEntities,
  queryEntitiesByGeometry,
  queryGeojson,
} from '../src/api/planningData';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const ENTITY_FIXTURE = {
  count: 2,
  entities: [
    {
      entity: 44009002,
      name: 'Whitehall Conservation Area',
      dataset: 'conservation-area',
      reference: 'CA-123',
      typology: 'geography',
      'start-date': '1969-01-01',
      'end-date': '',
      'entry-date': '2023-06-01',
    },
    {
      entity: 31000001,
      name: 'Buckingham Palace',
      dataset: 'listed-building',
      reference: '1234567',
      'listed-building-grade': 'I',
      typology: 'geography',
      'start-date': '1970-02-05',
      'end-date': '',
      'entry-date': '2023-06-01',
    },
  ],
};

describe('chunk', () => {
  it('splits into batches of the requested size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe('fetchAllDatasets', () => {
  it('returns the dataset list from /dataset.json', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ datasets: [{ dataset: 'green-belt', name: 'Green belt', typology: 'geography' }] }),
    );
    const datasets = await fetchAllDatasets(fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledWith('https://www.planning.data.gov.uk/dataset.json');
    expect(datasets).toHaveLength(1);
    expect(datasets[0].dataset).toBe('green-belt');
  });

  it('returns an empty list (registry fallback) when the API is unreachable', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('network down');
    });
    expect(await fetchAllDatasets(fetchFn as unknown as typeof fetch)).toEqual([]);
  });
});

describe('queryEntities', () => {
  it('batches datasets, includes coordinates, and merges entities', async () => {
    const urls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      urls.push(url);
      return jsonResponse(ENTITY_FIXTURE);
    });

    const slugs = Array.from({ length: DATASETS_PER_REQUEST + 3 }, (_, i) => `dataset-${i}`);
    const result = await queryEntities(51.5014, -0.1419, slugs, fetchFn as unknown as typeof fetch);

    expect(fetchFn).toHaveBeenCalledTimes(2); // 15 slugs → 2 batches
    expect(urls[0]).toContain('latitude=51.5014');
    expect(urls[0]).toContain('longitude=-0.1419');
    expect(urls[0]).toContain('dataset=dataset-0');
    expect(urls[1]).toContain(`dataset=dataset-${DATASETS_PER_REQUEST}`);
    expect(result.entities).toHaveLength(4); // fixture returned for both batches
    expect(result.failedDatasets).toEqual([]);
  });

  it('follows pagination links and merges all pages', async () => {
    const urls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes('offset=500')) {
        return jsonResponse({ count: 501, entities: [ENTITY_FIXTURE.entities[1]], links: {} });
      }
      return jsonResponse({
        count: 501,
        entities: [ENTITY_FIXTURE.entities[0]],
        links: { next: 'https://www.planning.data.gov.uk/entity.json?offset=500' },
      });
    });
    const result = await queryEntities(51.5, -0.1, ['conservation-area'], fetchFn as unknown as typeof fetch);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('offset=500');
    expect(result.entities).toHaveLength(2);
    expect(result.failedDatasets).toEqual([]);
  });

  it('retries a failed batch once, then reports its datasets as failed', async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls++;
      return jsonResponse({ message: 'oops' }, 500);
    });
    const result = await queryEntities(51.5, -0.1, ['a', 'b'], fetchFn as unknown as typeof fetch);
    expect(calls).toBe(2); // initial + one retry
    expect(result.entities).toEqual([]);
    expect(result.failedDatasets).toEqual(['a', 'b']);
  });
});

describe('queryEntitiesByGeometry', () => {
  const WKT = 'POLYGON ((-0.143 51.5, -0.14 51.5, -0.14 51.502, -0.143 51.502, -0.143 51.5))';

  it('queries by geometry + intersects instead of a point', async () => {
    const urls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      urls.push(url);
      return jsonResponse(ENTITY_FIXTURE);
    });
    const result = await queryEntitiesByGeometry(WKT, ['conservation-area'], fetchFn as unknown as typeof fetch);

    // URLSearchParams encodes spaces as "+" (form semantics the API decodes).
    const decoded = decodeURIComponent(urls[0]).replace(/\+/g, ' ');
    expect(decoded).toContain('geometry=POLYGON ((-0.143 51.5');
    expect(decoded).toContain('geometry_relation=intersects');
    expect(decoded).not.toContain('latitude=');
    expect(decoded).toContain('dataset=conservation-area');
    expect(result.entities).toHaveLength(2);
  });

  it('batches, paginates and reports failures like the point query', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('offset=500')) return jsonResponse({ count: 501, entities: [ENTITY_FIXTURE.entities[1]], links: {} });
      return jsonResponse({
        count: 501,
        entities: [ENTITY_FIXTURE.entities[0]],
        links: { next: 'https://www.planning.data.gov.uk/entity.json?offset=500' },
      });
    });
    const result = await queryEntitiesByGeometry(WKT, ['tree'], fetchFn as unknown as typeof fetch);
    expect(result.entities).toHaveLength(2); // both pages merged
    expect(result.failedDatasets).toEqual([]);
  });
});

describe('queryGeojson', () => {
  it('returns a merged FeatureCollection', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { dataset: 'green-belt' }, geometry: { type: 'Point', coordinates: [0, 0] } }],
      }),
    );
    const fc = await queryGeojson(51.5, -0.1, ['green-belt'], fetchFn as unknown as typeof fetch);
    expect(fc?.features).toHaveLength(1);
  });

  it('returns null for no datasets or on failure', async () => {
    expect(await queryGeojson(51.5, -0.1, [], vi.fn() as unknown as typeof fetch)).toBeNull();
    const failing = vi.fn(async () => jsonResponse({}, 500));
    expect(await queryGeojson(51.5, -0.1, ['x'], failing as unknown as typeof fetch)).toBeNull();
  });
});

describe('entityPageUrl', () => {
  it('links to the entity page', () => {
    expect(entityPageUrl(42)).toBe('https://www.planning.data.gov.uk/entity/42');
  });
});

describe('fetchEntityGeometry', () => {
  const POLY: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [[[-0.14, 51.5], [-0.13, 51.5], [-0.13, 51.51], [-0.14, 51.51], [-0.14, 51.5]]],
  };

  it('extracts a polygon from a Feature response', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe('https://www.planning.data.gov.uk/entity/301.geojson');
      return jsonResponse({ type: 'Feature', properties: {}, geometry: POLY });
    });
    const geom = await fetchEntityGeometry(301, fetchFn as unknown as typeof fetch);
    expect(geom).toEqual(POLY);
  });

  it('extracts from a FeatureCollection and returns null for non-polygons or failure', async () => {
    const fc = vi.fn(async () =>
      jsonResponse({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: POLY }] }),
    );
    expect(await fetchEntityGeometry(1, fc as unknown as typeof fetch)).toEqual(POLY);

    const point = vi.fn(async () => jsonResponse({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }));
    expect(await fetchEntityGeometry(2, point as unknown as typeof fetch)).toBeNull();

    const failing = vi.fn(async () => jsonResponse({}, 404));
    expect(await fetchEntityGeometry(3, failing as unknown as typeof fetch)).toBeNull();
  });
});
