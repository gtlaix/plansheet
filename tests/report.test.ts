import { describe, expect, it } from 'vitest';
import { buildRegistry, scoreEntity, sortHits } from '../src/datasets';
import { entityDetailRows, groupConstraintHits } from '../src/ui/report';
import type { PlanningEntity, RegistryEntry } from '../src/types';

function entity(extra: Record<string, unknown> = {}): PlanningEntity {
  return {
    entity: 42,
    name: 'Buckingham Palace',
    dataset: 'listed-building',
    reference: '1234567',
    typology: 'geography',
    'start-date': '1970-02-05',
    'end-date': '',
    'entry-date': '2024-01-01',
    ...extra,
  };
}

describe('groupConstraintHits', () => {
  const reg = (slug: string): RegistryEntry => {
    const found = buildRegistry([]).find((r) => r.slug === slug);
    if (!found) throw new Error(`no registry entry for ${slug}`);
    return found;
  };
  const flood = (id: number, level: string): PlanningEntity =>
    entity({ entity: id, name: '', dataset: 'flood-risk-zone', reference: `FZ${id}`, 'flood-risk-level': level });

  it('groups pieces of the same designation and keeps ranking order', () => {
    const hits = sortHits([
      scoreEntity(flood(1, '2'), reg('flood-risk-zone')),
      scoreEntity(flood(2, '2'), reg('flood-risk-zone')),
      scoreEntity(entity({ entity: 3, dataset: 'listed-building', 'listed-building-grade': 'I' }), reg('listed-building')),
      scoreEntity(flood(4, '3'), reg('flood-risk-zone')),
    ]);
    const groups = groupConstraintHits(hits);
    // Grade I (98) first, then Zone 3 (80), then the two Zone 2s as one group
    expect(groups.map((g) => g.length)).toEqual([1, 1, 2]);
    expect(groups[0][0].registry.slug).toBe('listed-building');
    expect(groups[1][0].qualifier).toBe('Flood Zone 3'); // Zone 3 never merges with Zone 2
    expect(groups[2].map((h) => h.entity.entity).sort()).toEqual([1, 2]);
  });
});

describe('entityDetailRows', () => {
  it('exposes populated primitive fields with humanised labels', () => {
    const rows = entityDetailRows(entity({ 'listed-building-grade': 'I', 'organisation-entity': '16' }));
    const map = new Map(rows);
    expect(map.get('Reference')).toBe('1234567');
    expect(map.get('Listed building grade')).toBe('I');
    expect(map.get('Organisation entity')).toBe('16');
    expect(map.get('Dataset')).toBe('listed-building');
  });

  it('hides internal/duplicated fields and empty values', () => {
    const labels = entityDetailRows(entity({ point: 'POINT(0 0)', geometry: 'x' })).map(([l]) => l);
    expect(labels).not.toContain('Name'); // shown as the card title
    expect(labels).not.toContain('Entity');
    expect(labels).not.toContain('Typology');
    expect(labels).not.toContain('Point');
    expect(labels).not.toContain('Geometry');
    expect(labels).not.toContain('End date'); // empty string in the fixture
  });
});
