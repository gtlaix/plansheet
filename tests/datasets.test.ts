import { describe, expect, it } from 'vitest';
import { buildRegistry, DEFAULT_IMPACT, impactTier, OVERLAY, scoreEntity, sortHits } from '../src/datasets';
import type { ApiDataset, PlanningEntity, RegistryEntry, ScoredHit } from '../src/types';

function entity(dataset: string, extra: Record<string, unknown> = {}): PlanningEntity {
  return {
    entity: 1,
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

function reg(slug: string): RegistryEntry {
  const registry = buildRegistry([]);
  const found = registry.find((r) => r.slug === slug);
  if (!found) throw new Error(`no registry entry for ${slug}`);
  return found;
}

describe('buildRegistry', () => {
  it('includes every geography dataset from the API, mapped or not', () => {
    const api: ApiDataset[] = [
      { dataset: 'conservation-area', name: 'Conservation area', typology: 'geography' },
      { dataset: 'some-brand-new-dataset', name: 'Brand new dataset', typology: 'geography' },
      { dataset: 'article-4-direction', name: 'Article 4 direction (document)', typology: 'legal-instrument' },
    ];
    const registry = buildRegistry(api);
    const slugs = registry.map((r) => r.slug);
    expect(slugs).toContain('conservation-area');
    expect(slugs).toContain('some-brand-new-dataset');
    // non-geography datasets cannot intersect a point and are excluded
    expect(slugs).not.toContain('article-4-direction');

    const unknown = registry.find((r) => r.slug === 'some-brand-new-dataset')!;
    expect(unknown.category).toBe('other');
    expect(unknown.impactScore).toBe(DEFAULT_IMPACT);
    expect(unknown.unmapped).toBe(true);
    expect(unknown.label).toBe('Brand new dataset');
  });

  it('falls back to the full curated overlay when the API list is unavailable', () => {
    const registry = buildRegistry([]);
    expect(registry.length).toBe(Object.keys(OVERLAY).length);
    expect(registry.map((r) => r.slug)).toContain('listed-building');
  });
});

describe('scoreEntity modifiers', () => {
  it('ranks listed buildings by grade: I > II* > II', () => {
    const registry = reg('listed-building');
    const gradeI = scoreEntity(entity('listed-building', { 'listed-building-grade': 'I' }), registry);
    const gradeIIstar = scoreEntity(entity('listed-building', { 'listed-building-grade': 'II*' }), registry);
    const gradeII = scoreEntity(entity('listed-building', { 'listed-building-grade': 'II' }), registry);
    expect(gradeI.score).toBeGreaterThan(gradeIIstar.score);
    expect(gradeIIstar.score).toBeGreaterThan(gradeII.score);
    expect(gradeI.qualifier).toBe('Grade I');
  });

  it('ranks flood zones by level: 3 > 2 > 1', () => {
    const registry = reg('flood-risk-zone');
    const z3 = scoreEntity(entity('flood-risk-zone', { 'flood-risk-level': '3' }), registry);
    const z2 = scoreEntity(entity('flood-risk-zone', { 'flood-risk-level': '2' }), registry);
    const z1 = scoreEntity(entity('flood-risk-zone', { 'flood-risk-level': '1' }), registry);
    expect(z3.score).toBeGreaterThan(z2.score);
    expect(z2.score).toBeGreaterThan(z1.score);
    expect(z3.qualifier).toBe('Flood Zone 3');
  });

  it('uses the base score when no modifier field is present', () => {
    const registry = reg('green-belt');
    expect(scoreEntity(entity('green-belt'), registry).score).toBe(registry.impactScore);
  });
});

describe('sortHits ordering', () => {
  it('puts administrative context first, then constraints by impact — Grade I listing above Flood Zone 2', () => {
    const hits: ScoredHit[] = [
      scoreEntity(entity('flood-risk-zone', { 'flood-risk-level': '2' }), reg('flood-risk-zone')),
      scoreEntity(entity('listed-building', { 'listed-building-grade': 'I' }), reg('listed-building')),
      scoreEntity(entity('ward'), reg('ward')),
      scoreEntity(entity('article-4-direction-area'), reg('article-4-direction-area')),
      scoreEntity(entity('local-planning-authority'), reg('local-planning-authority')),
      scoreEntity(entity('conservation-area'), reg('conservation-area')),
    ];
    const sorted = sortHits(hits);
    const slugs = sorted.map((h) => h.registry.slug);

    // administrative first
    expect(new Set(slugs.slice(0, 2))).toEqual(new Set(['ward', 'local-planning-authority']));
    // then constraints by descending impact
    expect(slugs.slice(2)).toEqual([
      'listed-building',
      'conservation-area',
      'article-4-direction-area',
      'flood-risk-zone',
    ]);
  });

  it('Flood Zone 3 outranks a conservation area, Zone 2 does not', () => {
    const z3 = scoreEntity(entity('flood-risk-zone', { 'flood-risk-level': '3' }), reg('flood-risk-zone'));
    const z2 = scoreEntity(entity('flood-risk-zone', { 'flood-risk-level': '2' }), reg('flood-risk-zone'));
    const ca = scoreEntity(entity('conservation-area'), reg('conservation-area'));
    expect(sortHits([ca, z3]).map((h) => h.registry.slug)[0]).toBe('flood-risk-zone');
    expect(sortHits([ca, z2]).map((h) => h.registry.slug)[0]).toBe('conservation-area');
  });
});

describe('impactTier', () => {
  it('maps scores to tiers', () => {
    expect(impactTier(98)).toBe('very-high');
    expect(impactTier(70)).toBe('high');
    expect(impactTier(50)).toBe('medium');
    expect(impactTier(25)).toBe('low');
    expect(impactTier(10)).toBe('informational');
  });
});
