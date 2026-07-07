import { describe, expect, it } from 'vitest';
import { entityDetailRows } from '../src/ui/report';
import type { PlanningEntity } from '../src/types';

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
