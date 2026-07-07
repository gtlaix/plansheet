import { describe, expect, it } from 'vitest';
import { buildRegistry, scoreEntity, sortHits } from '../src/datasets';
import { reportToMarkdown } from '../src/ui/markdown';
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

describe('reportToMarkdown', () => {
  const hits = sortHits([
    scoreEntity(entity('local-planning-authority', { name: 'City of Westminster' }), reg('local-planning-authority')),
    scoreEntity(entity('listed-building', { name: 'Buckingham Palace', 'listed-building-grade': 'I' }), reg('listed-building')),
    scoreEntity(entity('flood-risk-zone', { name: 'Zone 2', 'flood-risk-level': '2' }), reg('flood-risk-zone')),
  ]);
  const md = reportToMarkdown({
    selection: { lat: 51.5014, lng: -0.1419, label: 'SW1A 1AA' },
    nearestPostcode: 'SW1A 1AA',
    hits,
    checked: buildRegistry([]),
    failedDatasets: [],
  });

  it('leads with the PlanSheet title and location', () => {
    expect(md.startsWith('# PlanSheet — SW1A 1AA')).toBe(true);
    expect(md).toContain('**Coordinates:** 51.50140, -0.14190');
  });

  it('lists administrative context and ranks the Grade I listing above the flood zone', () => {
    expect(md).toContain('**Local planning authority:** City of Westminster');
    expect(md.indexOf('Buckingham Palace')).toBeGreaterThan(-1);
    expect(md.indexOf('Buckingham Palace')).toBeLessThan(md.indexOf('Zone 2'));
    expect(md).toContain('https://www.planning.data.gov.uk/entity/42');
  });

  it('includes the data-gaps checklist', () => {
    expect(md).toContain('## Not covered by this check');
  });
});
