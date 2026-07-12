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

  it('puts planning applications in a Planning history section, not constraints', () => {
    const withApp = reportToMarkdown({
      selection: { lat: 51.5014, lng: -0.1419, label: 'SW1A 1AA' },
      nearestPostcode: null,
      hits: sortHits([
        scoreEntity(entity('listed-building', { name: 'Buckingham Palace', 'listed-building-grade': 'I' }), reg('listed-building')),
        scoreEntity(
          entity('planning-application', {
            entity: 77,
            name: '',
            reference: '24/01234/FUL',
            description: 'Two-storey rear extension',
            'planning-decision': 'granted',
            'decision-date': '2024-06-01',
            'documentation-url': 'https://lpa.example/apps/24-01234',
          }),
          reg('planning-application'),
        ),
      ]),
      checked: buildRegistry([]),
      failedDatasets: [],
    });
    expect(withApp).toContain('## Planning history (1 application)');
    expect(withApp).toContain('**Proposal:** Two-storey rear extension');
    expect(withApp).toContain('**Decision:** granted (2024-06-01)');
    expect(withApp).toContain('https://lpa.example/apps/24-01234');
    expect(withApp).toContain('not** a complete planning history');
    // the constraints section counts only the listing, not the application
    expect(withApp).toContain('## Constraints & designations (1)');
  });
});
