import { describe, expect, it } from 'vitest';
import { buildRegistry, scoreEntity, sortHits } from '../src/datasets';
import { reportToJson } from '../src/ui/reportJson';
import type { PlanningEntity, RegistryEntry } from '../src/types';

function reg(slug: string): RegistryEntry {
  const found = buildRegistry([]).find((r) => r.slug === slug);
  if (!found) throw new Error(`no registry entry for ${slug}`);
  return found;
}

function entity(dataset: string, extra: Record<string, unknown> = {}): PlanningEntity {
  return {
    entity: 42,
    name: `${dataset} entity`,
    dataset,
    reference: 'REF1',
    typology: 'geography',
    'start-date': '2000-01-01',
    'end-date': '',
    'entry-date': '2020-01-01',
    ...extra,
  };
}

describe('reportToJson', () => {
  const hits = sortHits([
    scoreEntity(entity('local-planning-authority', { name: 'City of Westminster' }), reg('local-planning-authority')),
    scoreEntity(entity('listed-building', { name: 'Buckingham Palace', 'listed-building-grade': 'I', 'organisation-entity': '16' }), reg('listed-building')),
  ]);
  const report = reportToJson({
    selection: { lat: 51.5014, lng: -0.1419, label: 'SW1A 1AA' },
    nearestPostcode: 'SW1A 1AA',
    hits,
    checked: buildRegistry([]),
    failedDatasets: ['scheduled-monument'],
  });

  it('emits a versioned schema with location and disclaimer', () => {
    expect(report.schemaVersion).toBe(1);
    expect(report.location).toMatchObject({ latitude: 51.5014, longitude: -0.1419, label: 'SW1A 1AA', nearestPostcode: 'SW1A 1AA' });
    expect(report.disclaimer).toMatch(/not a substitute/i);
    expect(() => JSON.stringify(report)).not.toThrow();
  });

  it('separates administrative context from scored constraints', () => {
    expect(report.administrative.map((a) => a.name)).toContain('City of Westminster');
    const listed = report.constraints.find((c) => c.dataset === 'listed-building');
    expect(listed).toBeDefined();
    expect(listed!.impactTier).toBe('Very high impact');
    expect(listed!.qualifier).toBe('Grade I');
    expect(listed!.organisation).toBe('16');
    expect(listed!.url).toBe('https://www.planning.data.gov.uk/entity/42');
  });

  it('records coverage honesty: partial vs clear, failures, and gaps', () => {
    const partial = report.coverageIncomplete.map((c) => c.dataset);
    const clear = report.checkedClear.map((c) => c.dataset);
    expect(partial).toContain('article-4-direction-area'); // LPA-sourced
    expect(clear).toContain('site-of-special-scientific-interest'); // nationally complete
    expect(report.couldNotCheck).toEqual(['scheduled-monument']);
    expect(report.notCovered.length).toBeGreaterThan(0);
  });

  it('omits the site block for a point check but includes it for a boundary', () => {
    expect(report.site).toBeUndefined();

    const geojson: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [[[-0.145, 51.499], [-0.138, 51.499], [-0.138, 51.504], [-0.145, 51.504], [-0.145, 51.499]]],
    };
    const withSite = reportToJson({
      selection: { lat: 51.5014, lng: -0.1419, label: 'Site boundary' },
      site: { geojson, areaM2: 123456 },
      nearestPostcode: null,
      hits,
      checked: buildRegistry([]),
      failedDatasets: [],
    });
    expect(withSite.site).toBeDefined();
    expect(withSite.site!.areaSquareMetres).toBe(123456);
    expect(withSite.site!.areaHectares).toBeCloseTo(12.3456, 4);
    expect(withSite.site!.geometry.type).toBe('Polygon');
  });
});
