import type { ApiDataset, Category, PlanningEntity, RegistryEntry, ScoredHit } from './types';

/**
 * Curated overlay for datasets known on the Planning Data platform.
 *
 * The definitive dataset list is fetched from GET /dataset.json at runtime and
 * every dataset with `typology: geography` is queried, whether or not it
 * appears here. This table only supplies ranking metadata: category, a base
 * impact score (0–100, higher = greater constraint on the planning potential
 * of a site) and a one-line explanation. Slugs missing from this table fall
 * into the "other" category with DEFAULT_IMPACT so nothing is ever dropped.
 */
interface OverlayEntry {
  category: Category;
  impactScore: number;
  blurb?: string;
  label?: string;
}

export const DEFAULT_IMPACT = 40;

export const OVERLAY: Record<string, OverlayEntry> = {
  // --- Administrative context (always shown first, not scored) ---
  'local-planning-authority': { category: 'administrative', impactScore: 0, blurb: 'The authority that decides planning applications here.' },
  'local-authority-district': { category: 'administrative', impactScore: 0 },
  region: { category: 'administrative', impactScore: 0 },
  ward: { category: 'administrative', impactScore: 0 },
  parish: { category: 'administrative', impactScore: 0 },
  'built-up-area': { category: 'administrative', impactScore: 0 },
  'title-boundary': { category: 'administrative', impactScore: 0, blurb: 'HM Land Registry registered title extent.' },
  'local-resilience-forum-boundary': { category: 'administrative', impactScore: 0 },

  // --- Statutory heritage: the strongest constraints ---
  'scheduled-monument': { category: 'heritage', impactScore: 95, blurb: 'Nationally important monument; works need Scheduled Monument Consent.' },
  'listed-building': { category: 'heritage', impactScore: 85, blurb: 'Statutorily listed; alterations need Listed Building Consent.' },
  'listed-building-outline': { category: 'heritage', impactScore: 85, blurb: 'Extent of a listed building; alterations need Listed Building Consent.' },
  'world-heritage-site': { category: 'heritage', impactScore: 92, blurb: 'UNESCO World Heritage Site; development is tightly controlled.' },
  'protected-wreck-site': { category: 'heritage', impactScore: 90 },
  'building-preservation-notice': { category: 'heritage', impactScore: 88, blurb: 'Temporary listed-building protection is in force.' },
  'world-heritage-site-buffer-zone': { category: 'heritage', impactScore: 72, blurb: 'Development must protect the setting of a World Heritage Site.' },
  'heritage-at-risk': { category: 'heritage', impactScore: 70 },
  'conservation-area': { category: 'heritage', impactScore: 68, blurb: 'Extra planning controls protect the character of the area; some permitted development rights are restricted.' },
  'park-and-garden': { category: 'heritage', impactScore: 66, blurb: 'Registered historic park or garden; harm carries significant planning weight.' },
  battlefield: { category: 'heritage', impactScore: 65 },
  'archaeological-priority-area': { category: 'heritage', impactScore: 62, blurb: 'Archaeological assessment likely required before development.' },
  'locally-listed-building': { category: 'heritage', impactScore: 45, blurb: 'On the local heritage list; a material consideration in decisions.' },
  'certificate-of-immunity': { category: 'info', impactScore: 15, blurb: 'Certified immune from listing for five years — reduces heritage risk.' },

  // --- Statutory ecology ---
  'site-of-special-scientific-interest': { category: 'ecology', impactScore: 90, blurb: 'SSSI: operations likely to damage the site need Natural England consent.' },
  'special-area-of-conservation': { category: 'ecology', impactScore: 90, blurb: 'European protected habitat; development needs Habitats Regulations assessment.' },
  'special-protection-area': { category: 'ecology', impactScore: 90, blurb: 'European protected bird habitat; development needs Habitats Regulations assessment.' },
  ramsar: { category: 'ecology', impactScore: 90, blurb: 'Internationally important wetland, protected as a European site.' },
  'ancient-woodland': { category: 'ecology', impactScore: 85, blurb: 'Irreplaceable habitat; development causing loss is wholly exceptional.' },
  'national-nature-reserve': { category: 'ecology', impactScore: 80 },
  'local-nature-reserve': { category: 'ecology', impactScore: 48 },
  'nature-improvement-area': { category: 'ecology', impactScore: 40 },

  // --- Flooding ---
  'flood-risk-zone': { category: 'flood', impactScore: 50, blurb: 'Flood Zone 2/3: sequential and possibly exception tests apply; flood risk assessment required.' },
  'flood-storage-area': { category: 'flood', impactScore: 75, blurb: 'Functional floodplain: most development is inappropriate here.' },

  // --- Strong policy / landscape designations ---
  'green-belt': { category: 'landscape', impactScore: 78, blurb: 'Inappropriate development is refused except in very special circumstances.' },
  'national-park': { category: 'landscape', impactScore: 77, blurb: 'Great weight is given to conserving landscape and scenic beauty; major development is restricted.' },
  'area-of-outstanding-natural-beauty': { category: 'landscape', impactScore: 76, blurb: 'National Landscape (AONB): great weight on conserving natural beauty.' },
  'heritage-coast': { category: 'landscape', impactScore: 60 },

  // --- Local restrictions ---
  'article-4-direction-area': { category: 'local', impactScore: 55, blurb: 'Permitted development rights are withdrawn here — planning permission needed for works that are normally allowed.' },
  'tree-preservation-zone': { category: 'local', impactScore: 50, blurb: 'Tree Preservation Order area: consent needed to prune or fell protected trees.' },
  tree: { category: 'local', impactScore: 48, blurb: 'Individually protected tree: consent needed to prune or fell.' },
  'asset-of-community-value': { category: 'local', impactScore: 42, blurb: 'Community right to bid may delay disposal; a material planning consideration.' },
  'air-quality-management-area': { category: 'local', impactScore: 38, blurb: 'Air quality assessment may be needed for development.' },

  // --- Informational / lower impact ---
  'agricultural-land-classification': { category: 'info', impactScore: 30, blurb: 'Best and most versatile agricultural land is protected by policy.' },
  'infrastructure-project': { category: 'info', impactScore: 35 },
  'central-activities-zone': { category: 'info', impactScore: 25 },
  'design-code-area': { category: 'info', impactScore: 22, blurb: 'A design code applies to development here.' },
  'brownfield-land': { category: 'info', impactScore: 20, blurb: 'On the brownfield register — generally an opportunity, not a constraint.' },
  'brownfield-site': { category: 'info', impactScore: 20 },
  'local-plan-boundary': { category: 'info', impactScore: 10 },
  'educational-establishment': { category: 'info', impactScore: 12 },
  'transport-access-node': { category: 'info', impactScore: 8 },
};

export const CATEGORY_LABELS: Record<Category, string> = {
  administrative: 'Administrative',
  heritage: 'Heritage',
  ecology: 'Ecology & nature',
  flood: 'Flood risk',
  landscape: 'Landscape & policy',
  local: 'Local restrictions',
  info: 'Informational',
  other: 'Other designations',
};

/**
 * Merge the live dataset list with the curated overlay. Every dataset with
 * `typology: geography` is included; unmapped slugs get sensible defaults.
 */
export function buildRegistry(apiDatasets: ApiDataset[]): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  const seen = new Set<string>();

  for (const d of apiDatasets) {
    if (d.typology !== 'geography') continue;
    if (seen.has(d.dataset)) continue;
    seen.add(d.dataset);
    const overlay = OVERLAY[d.dataset];
    entries.push({
      slug: d.dataset,
      label: overlay?.label ?? d.name ?? d.dataset,
      category: overlay?.category ?? 'other',
      impactScore: overlay?.impactScore ?? DEFAULT_IMPACT,
      blurb: overlay?.blurb,
      unmapped: !overlay,
    });
  }

  // If the API list is unavailable we still want a working app: fall back to
  // every curated slug (minus any already present).
  if (entries.length === 0) {
    for (const [slug, overlay] of Object.entries(OVERLAY)) {
      entries.push({
        slug,
        label: overlay.label ?? titleCase(slug),
        category: overlay.category,
        impactScore: overlay.impactScore,
        blurb: overlay.blurb,
      });
    }
  }

  const unmapped = entries.filter((e) => e.unmapped).map((e) => e.slug);
  if (unmapped.length > 0) {
    console.warn(`plansheet: datasets not in the curated overlay (ranked at default impact ${DEFAULT_IMPACT}):`, unmapped);
  }

  return entries;
}

function titleCase(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Listed building / park-and-garden grade adjustments. */
const GRADE_SCORES: Record<string, Record<string, number>> = {
  'listed-building': { I: 98, 'II*': 93, II: 85 },
  'listed-building-outline': { I: 98, 'II*': 93, II: 85 },
  'park-and-garden': { I: 75, 'II*': 70, II: 66 },
};

/** Flood Zone 3 is a far greater constraint than Zone 2. */
const FLOOD_LEVEL_SCORES: Record<string, number> = { '3': 80, '2': 50, '1': 10 };

function entityGrade(entity: PlanningEntity): string | undefined {
  const grade =
    entity['listed-building-grade'] ?? entity['park-and-garden-grade'] ?? entity['grade'];
  return typeof grade === 'string' && grade.trim() !== '' ? grade.trim() : undefined;
}

/**
 * Compute the final impact score and human qualifier for one entity hit,
 * applying per-entity modifiers (listing grade, flood risk level).
 */
export function scoreEntity(entity: PlanningEntity, registry: RegistryEntry): ScoredHit {
  let score = registry.impactScore;
  let qualifier: string | undefined;

  const gradeTable = GRADE_SCORES[registry.slug];
  if (gradeTable) {
    const grade = entityGrade(entity);
    if (grade && gradeTable[grade] !== undefined) {
      score = gradeTable[grade];
      qualifier = `Grade ${grade}`;
    }
  }

  if (registry.slug === 'flood-risk-zone') {
    const level = String(entity['flood-risk-level'] ?? '').trim();
    if (FLOOD_LEVEL_SCORES[level] !== undefined) {
      score = FLOOD_LEVEL_SCORES[level];
      qualifier = `Flood Zone ${level}`;
    }
  }

  return { entity, registry, score, qualifier };
}

/**
 * Order hits for the plan sheet: administrative context first (stable API
 * order within), then constraints by descending impact score. Ties break
 * alphabetically by dataset label, then by entity name, so output is stable.
 */
export function sortHits(hits: ScoredHit[]): ScoredHit[] {
  return [...hits].sort((a, b) => {
    const aAdmin = a.registry.category === 'administrative' ? 0 : 1;
    const bAdmin = b.registry.category === 'administrative' ? 0 : 1;
    if (aAdmin !== bAdmin) return aAdmin - bAdmin;
    if (aAdmin === 0) return a.registry.label.localeCompare(b.registry.label);
    if (a.score !== b.score) return b.score - a.score;
    const byLabel = a.registry.label.localeCompare(b.registry.label);
    if (byLabel !== 0) return byLabel;
    return String(a.entity.name ?? '').localeCompare(String(b.entity.name ?? ''));
  });
}

export type ImpactTier = 'very-high' | 'high' | 'medium' | 'low' | 'informational';

export function impactTier(score: number): ImpactTier {
  if (score >= 85) return 'very-high';
  if (score >= 65) return 'high';
  if (score >= 45) return 'medium';
  if (score >= 20) return 'low';
  return 'informational';
}

export const TIER_LABELS: Record<ImpactTier, string> = {
  'very-high': 'Very high impact',
  high: 'High impact',
  medium: 'Medium impact',
  low: 'Low impact',
  informational: 'Informational',
};
