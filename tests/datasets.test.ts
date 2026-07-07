import { describe, expect, it } from 'vitest';
import {
  article4Detail,
  buildRegistry,
  classifyChecked,
  DEFAULT_IMPACT,
  EXCLUDED_SLUGS,
  impactTier,
  OVERLAY,
  scoreEntity,
  sortHits,
} from '../src/datasets';
import { DATA_GAPS } from '../src/dataGaps';
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

  it('drops the England border and addressing noise slugs', () => {
    const api: ApiDataset[] = [
      { dataset: 'green-belt', name: 'Green belt', typology: 'geography' },
      { dataset: 'border', name: 'Border', typology: 'geography' },
      { dataset: 'uprn', name: 'UPRN', typology: 'geography' },
      { dataset: 'postcode', name: 'Postcode', typology: 'geography' },
    ];
    const slugs = buildRegistry(api).map((r) => r.slug);
    expect(EXCLUDED_SLUGS.has('border')).toBe(true);
    expect(EXCLUDED_SLUGS.has('uprn')).toBe(true);
    expect(slugs).toContain('green-belt');
    expect(slugs).not.toContain('border');
    expect(slugs).not.toContain('uprn');
    expect(slugs).not.toContain('postcode');
  });

  it('treats local plan boundary as administrative context, not a constraint', () => {
    expect(reg('local-plan-boundary').category).toBe('administrative');
    expect(reg('local-plan-boundary').impactScore).toBe(0);
  });

  it('ranks the reconciled datasets in sensible categories', () => {
    expect(reg('metropolitan-open-land').category).toBe('landscape');
    expect(reg('control-of-major-accident-hazards-site').category).toBe('hazard');
    expect(reg('mineral-safeguarding-area').category).toBe('info');
    expect(reg('main-river').category).toBe('flood');
    // the corrected minerals slug is present; the wrong guess is gone
    expect(OVERLAY['minerals-plan-boundary']).toBeUndefined();
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

  it('scores agricultural land by grade: best-and-most-versatile > poorer > urban', () => {
    const registry = reg('agricultural-land-classification');
    const field = 'agricultural-land-classification-grade';
    const grade1 = scoreEntity(entity('agricultural-land-classification', { [field]: 'Grade 1' }), registry);
    const grade3b = scoreEntity(entity('agricultural-land-classification', { [field]: 'Grade 3b' }), registry);
    const urban = scoreEntity(entity('agricultural-land-classification', { [field]: 'Urban' }), registry);
    expect(grade1.score).toBeGreaterThan(grade3b.score);
    expect(grade3b.score).toBeGreaterThan(urban.score);
    expect(grade1.qualifier).toBe('Grade 1');
    expect(impactTier(urban.score)).toBe('informational');
  });

  it('surfaces what an Article 4 direction removes', () => {
    const registry = reg('article-4-direction-area');
    const withDetail = scoreEntity(
      entity('article-4-direction-area', { description: 'Removes PD right for C3 to C4 (HMO) change of use.' }),
      registry,
    );
    expect(withDetail.detail).toContain('C3 to C4');
    expect(scoreEntity(entity('article-4-direction-area'), registry).detail).toBeUndefined();
    expect(article4Detail(entity('article-4-direction-area', { notes: 'Removes fenestration PD rights.' }))).toBe(
      'Removes fenestration PD rights.',
    );
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

describe('classifyChecked (ISSUES-3: zero-hit ≠ clear for partial datasets)', () => {
  it('splits no-hit datasets into clear vs partial-coverage, excluding hits and failures', () => {
    const registry = buildRegistry([]);
    const hits = [scoreEntity(entity('green-belt'), reg('green-belt'))];
    const { clear, partialNoData } = classifyChecked(registry, hits, ['scheduled-monument']);

    const clearSlugs = clear.map((c) => c.slug);
    const partialSlugs = partialNoData.map((c) => c.slug);

    // article 4 / TPO are LPA-sourced: absence of data must not read as clearance
    expect(partialSlugs).toContain('article-4-direction-area');
    expect(partialSlugs).toContain('tree-preservation-zone');
    // national datasets with no hit are genuinely clear
    expect(clearSlugs).toContain('site-of-special-scientific-interest');
    // hits and failed datasets appear in neither list
    expect(clearSlugs).not.toContain('green-belt');
    expect([...clearSlugs, ...partialSlugs]).not.toContain('scheduled-monument');
  });
});

describe('data gaps register', () => {
  it('has substantive entries and no id collides with an overlay slug', () => {
    expect(DATA_GAPS.length).toBeGreaterThanOrEqual(15);
    const overlaySlugs = new Set(Object.keys(OVERLAY));
    for (const gap of DATA_GAPS) {
      expect(overlaySlugs.has(gap.id)).toBe(false);
      expect(gap.whereToCheck.length).toBeGreaterThan(0);
    }
  });

  it('no longer lists topics that are now platform datasets', () => {
    const ids = new Set(DATA_GAPS.map((g) => g.id));
    for (const removed of ['commons', 'hse', 'contaminated-land', 'safeguarding-air', 'safeguarding-infra']) {
      expect(ids.has(removed)).toBe(false);
    }
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
