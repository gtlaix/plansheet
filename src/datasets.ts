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
  /**
   * LPA-sourced dataset with incomplete national coverage (only councils on
   * the Open Digital Planning programme have submitted). A zero-hit on these
   * means "no data", never "no constraint" — the report must say so.
   */
  partialCoverage?: boolean;
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
  'local-plan-boundary': { category: 'administrative', impactScore: 0, blurb: 'The adopted local plan area covering this site.' },

  // --- Statutory heritage: the strongest constraints ---
  'scheduled-monument': { category: 'heritage', impactScore: 95, blurb: 'Nationally important monument; works need Scheduled Monument Consent.' },
  'listed-building': { category: 'heritage', impactScore: 85, blurb: 'Statutorily listed; alterations need Listed Building Consent.' },
  'listed-building-outline': { category: 'heritage', impactScore: 85, blurb: 'Extent of a listed building; alterations need Listed Building Consent.' },
  'world-heritage-site': { category: 'heritage', impactScore: 92, blurb: 'UNESCO World Heritage Site; development is tightly controlled.' },
  'protected-wreck-site': { category: 'heritage', impactScore: 90 },
  'building-preservation-notice': { category: 'heritage', impactScore: 88, blurb: 'Temporary listed-building protection is in force.' },
  'world-heritage-site-buffer-zone': { category: 'heritage', impactScore: 72, blurb: 'Development must protect the setting of a World Heritage Site.' },
  'heritage-at-risk': { category: 'heritage', impactScore: 70 },
  'conservation-area': { category: 'heritage', impactScore: 68, blurb: 'Extra planning controls protect the character of the area; some permitted development rights are restricted.', partialCoverage: true },
  'park-and-garden': { category: 'heritage', impactScore: 66, blurb: 'Registered historic park or garden; harm carries significant planning weight.' },
  battlefield: { category: 'heritage', impactScore: 65 },
  'archaeological-priority-area': { category: 'heritage', impactScore: 62, blurb: 'Archaeological assessment likely required before development.', partialCoverage: true },
  'non-designated-archeology-asset-of-national-importance': { category: 'heritage', impactScore: 58, blurb: 'Archaeology of national importance though not scheduled; strong weight against harm.' },
  'heritage-action-zone': { category: 'heritage', impactScore: 52, blurb: 'Historic England regeneration area focused on heritage-led renewal.' },
  'locally-listed-building': { category: 'heritage', impactScore: 45, blurb: 'On the local heritage list; a material consideration in decisions.', partialCoverage: true },
  'non-designated-and-locally-listed-historic-asset': { category: 'heritage', impactScore: 44, blurb: 'Non-designated heritage asset; weighed in the planning balance.', partialCoverage: true },
  'certificate-of-immunity': { category: 'info', impactScore: 15, blurb: 'Certified immune from listing for five years — reduces heritage risk.' },

  // --- Statutory ecology ---
  'site-of-special-scientific-interest': { category: 'ecology', impactScore: 90, blurb: 'SSSI: operations likely to damage the site need Natural England consent.' },
  'special-area-of-conservation': { category: 'ecology', impactScore: 90, blurb: 'European protected habitat; development needs Habitats Regulations assessment.' },
  'special-protection-area': { category: 'ecology', impactScore: 90, blurb: 'European protected bird habitat; development needs Habitats Regulations assessment.' },
  ramsar: { category: 'ecology', impactScore: 90, blurb: 'Internationally important wetland, protected as a European site.' },
  'ancient-woodland': { category: 'ecology', impactScore: 85, blurb: 'Irreplaceable habitat; development causing loss is wholly exceptional.' },
  'national-nature-reserve': { category: 'ecology', impactScore: 80 },
  'nutrient-neutrality-catchment': { category: 'ecology', impactScore: 55, blurb: 'Habitats Regulations: net-zero nutrient mitigation is required before residential development can proceed.' },
  'wildbelt': { category: 'ecology', impactScore: 50, blurb: 'Land identified to recover nature; development expected to protect its potential.' },
  'local-nature-reserve': { category: 'ecology', impactScore: 48 },
  'best-and-most-versatile-agricultural-land': { category: 'ecology', impactScore: 48, blurb: 'Best and most versatile farmland (Grades 1–3a); its loss carries policy weight.' },
  'common-land-and-village-green': { category: 'ecology', impactScore: 55, blurb: 'Registered common or village green; building on it is tightly restricted.', partialCoverage: true },
  'open-space': { category: 'ecology', impactScore: 45, blurb: 'Protected open space; loss resisted unless surplus or replaced.' },
  'suitable-alternative-green-space': { category: 'ecology', impactScore: 35, blurb: 'SANG — recreational mitigation land for nearby protected habitats.' },
  'forest-inventory': { category: 'ecology', impactScore: 40, blurb: 'Mapped woodland; tree loss is a material consideration.' },
  'wildlife': { category: 'ecology', impactScore: 40 },
  'nature-improvement-area': { category: 'ecology', impactScore: 40 },
  'local-nature-recovery-strategy': { category: 'ecology', impactScore: 32, blurb: 'Within a local nature recovery strategy area — informs biodiversity net gain.' },

  // --- Flooding & water ---
  'flood-risk-zone': { category: 'flood', impactScore: 50, blurb: 'Flood Zone 2/3: sequential and possibly exception tests apply; flood risk assessment required.' },
  'flood-storage-area': { category: 'flood', impactScore: 75, blurb: 'Functional floodplain: most development is inappropriate here.' },
  'coastal-change-management-area': { category: 'flood', impactScore: 65, blurb: 'Coastal erosion zone; only development that will not be at risk is permitted.' },
  'main-river': { category: 'flood', impactScore: 55, blurb: 'Environment Agency main river: an environmental permit is needed for work in or near it (typically within 8m).' },
  'internal-drainage-district': { category: 'flood', impactScore: 25, blurb: 'Within an Internal Drainage Board area; drainage consent may be required.' },

  // --- Strong policy / landscape designations ---
  'green-belt': { category: 'landscape', impactScore: 78, blurb: 'Inappropriate development is refused except in very special circumstances.' },
  'metropolitan-open-land': { category: 'landscape', impactScore: 77, blurb: 'London designation given the same protection as Green Belt.' },
  'national-park': { category: 'landscape', impactScore: 77, blurb: 'Great weight is given to conserving landscape and scenic beauty; major development is restricted.' },
  'area-of-outstanding-natural-beauty': { category: 'landscape', impactScore: 76, blurb: 'National Landscape (AONB): great weight on conserving natural beauty.' },
  'local-green-space': { category: 'landscape', impactScore: 70, blurb: 'Local Green Space: development ruled out other than in special circumstances (Green Belt policy applies).' },
  'protected-view': { category: 'landscape', impactScore: 60, blurb: 'Within a protected view/vista; building heights and massing are constrained.' },
  'heritage-coast': { category: 'landscape', impactScore: 60 },

  // --- Hazard, safeguarding & ground conditions ---
  'control-of-major-accident-hazards-site': { category: 'hazard', impactScore: 60, blurb: 'COMAH consultation zone: the HSE is consulted and development near hazardous installations may be refused.' },
  'contaminated-land': { category: 'hazard', impactScore: 58, blurb: 'Known or suspected contamination; investigation and remediation likely required.', partialCoverage: true },
  'safety-hazard-area': { category: 'hazard', impactScore: 55, blurb: 'Notified hazardous-substance consultation zone; sensitive uses may be resisted.' },
  'hs2-safeguarded-area': { category: 'hazard', impactScore: 55, blurb: 'Safeguarded for HS2; development may be refused or subject to consultation.' },
  'safeguarded-military-explosives-site': { category: 'hazard', impactScore: 50, blurb: 'Explosives safeguarding zone; MOD is consulted on nearby development.' },
  'safeguarded-aerodrome': { category: 'hazard', impactScore: 45, blurb: 'Aerodrome safeguarding: height, lighting and bird-strike constraints apply.' },
  'historic-stone-quarry': { category: 'hazard', impactScore: 38, blurb: 'Former quarry — potential ground stability/mining legacy to investigate.' },
  'safeguarded-wharf': { category: 'hazard', impactScore: 35, blurb: 'Safeguarded wharf; loss of freight-handling capacity is resisted.' },
  'public-safety-zone-around-airport': { category: 'hazard', impactScore: 58, blurb: 'Public Safety Zone at a runway end: development that increases the number of people living, working or gathering here is not permitted.' },

  // --- Local restrictions ---
  'article-4-direction-area': { category: 'local', impactScore: 55, blurb: 'Permitted development rights are withdrawn here — planning permission needed for works that are normally allowed.', partialCoverage: true },
  'tree-preservation-zone': { category: 'local', impactScore: 50, blurb: 'Tree Preservation Order area: consent needed to prune or fell protected trees.', partialCoverage: true },
  tree: { category: 'local', impactScore: 48, blurb: 'Individually protected tree: consent needed to prune or fell.', partialCoverage: true },
  'asset-of-community-value': { category: 'local', impactScore: 42, blurb: 'Community right to bid may delay disposal; a material planning consideration.', partialCoverage: true },
  'air-quality-management-area': { category: 'local', impactScore: 38, blurb: 'Air quality assessment may be needed for development.', partialCoverage: true },

  // --- Informational / lower impact ---
  'agricultural-land-classification': { category: 'info', impactScore: 30, blurb: 'Agricultural land grade; the best and most versatile grades (1–3a) are protected by policy.' },
  'infrastructure-project': { category: 'info', impactScore: 35 },
  'employment-allocation': { category: 'info', impactScore: 25, blurb: 'Allocated for employment use in the development plan.' },
  'central-activities-zone': { category: 'info', impactScore: 25 },
  'gypsy-and-traveller-site': { category: 'info', impactScore: 28, blurb: 'Allocated or existing Gypsy and Traveller site — a land-use consideration for development here.' },
  'design-code-area': { category: 'info', impactScore: 22, blurb: 'A design code applies to development here.', partialCoverage: true },
  'brownfield-land': { category: 'info', impactScore: 20, blurb: 'On the brownfield register — generally an opportunity, not a constraint.', partialCoverage: true },
  'brownfield-site': { category: 'info', impactScore: 20, partialCoverage: true },
  'development-corporation-boundary': { category: 'info', impactScore: 18, blurb: 'A development corporation is the planning authority here.' },
  'development-plan-boundary': { category: 'info', impactScore: 15, blurb: 'Covered by a development plan document.' },
  'development-policy-area': { category: 'info', impactScore: 15, blurb: 'A specific development-plan policy applies to this area.' },
  'self-and-custom-buildarea': { category: 'info', impactScore: 12, blurb: 'Area relevant to self- and custom-build housing provision.' },
  'educational-establishment': { category: 'info', impactScore: 12 },
  'development-plan-geography': { category: 'info', impactScore: 10 },
  'transport-access-node': { category: 'info', impactScore: 8 },
  // Minerals safeguarding and waste plan areas are strategic policy layers, not
  // site-level constraints for most applications — kept low/informational.
  'mineral-safeguarding-area': { category: 'info', impactScore: 30, blurb: 'Safeguarded mineral resource; a minerals assessment may be needed to show it will not be sterilised.' },
  'minerals-plan-boundary': { category: 'info', impactScore: 8, blurb: 'Within a minerals plan area (strategic policy — informational for most development).' },
  'waste-plan-boundary': { category: 'info', impactScore: 8, blurb: 'Within a waste plan area (strategic policy — informational for most development).' },
};

/**
 * Geography datasets that are noise for a constraint check: the nationwide
 * England outline (`border`, which intersects every English point) and the
 * addressing layers (which return nearby addresses, not designations). Removed
 * from the registry so they are never queried or shown. Slugs reconciled
 * 2026-07-07 against the MHCLG dataset catalogue (digital-land/specification).
 */
export const EXCLUDED_SLUGS = new Set<string>(['border', 'address', 'postcode', 'street', 'uprn']);

export const CATEGORY_LABELS: Record<Category, string> = {
  administrative: 'Administrative',
  heritage: 'Heritage',
  ecology: 'Ecology & nature',
  flood: 'Flood & water',
  landscape: 'Landscape & policy',
  hazard: 'Hazard & safeguarding',
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
    if (EXCLUDED_SLUGS.has(d.dataset)) continue;
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
      partialCoverage: overlay?.partialCoverage,
    });
  }

  // If the API list is unavailable we still want a working app: fall back to
  // every curated slug (minus any already present).
  if (entries.length === 0) {
    for (const [slug, overlay] of Object.entries(OVERLAY)) {
      if (EXCLUDED_SLUGS.has(slug)) continue;
      entries.push({
        slug,
        label: overlay.label ?? titleCase(slug),
        category: overlay.category,
        impactScore: overlay.impactScore,
        blurb: overlay.blurb,
        partialCoverage: overlay.partialCoverage,
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

/**
 * Agricultural Land Classification only matters when the land is farmed:
 * "urban"/"non-agricultural" is noise; the best-and-most-versatile grades
 * (1, 2, 3a) carry real policy weight. Keys are lower-cased grade strings with
 * the "grade " prefix stripped. Field `agricultural-land-classification-grade`
 * confirmed against the MHCLG catalogue (2026-07-07).
 */
const ALC_GRADE_SCORES: Record<string, number> = {
  '1': 50,
  '2': 48,
  '3a': 45,
  '3b': 22,
  '3': 22,
  '4': 18,
  '5': 15,
  urban: 8,
  'non-agricultural': 8,
  'non agricultural': 8,
};

function alcGrade(entity: PlanningEntity): string | undefined {
  const raw =
    entity['agricultural-land-classification-grade'] ??
    entity['agricultural-land-classification'] ??
    entity['grade'];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

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
  let detail: string | undefined;

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

  if (registry.slug === 'agricultural-land-classification') {
    const grade = alcGrade(entity);
    if (grade) {
      const key = grade.toLowerCase().replace(/^grade\s*/, '');
      if (ALC_GRADE_SCORES[key] !== undefined) score = ALC_GRADE_SCORES[key];
      qualifier = grade;
    }
  }

  if (registry.slug === 'article-4-direction-area') {
    detail = article4Detail(entity);
  }

  return { entity, registry, score, qualifier, detail };
}

/**
 * What an Article 4 direction actually removes — the useful bit for a planner.
 * `article-4-direction-area` carries `permitted-development-rights` plus free-text
 * `description`/`notes` (confirmed against the MHCLG catalogue, 2026-07-07); the
 * prose fields are preferred when populated, falling back to the rights list.
 */
export function article4Detail(entity: PlanningEntity): string | undefined {
  for (const field of ['description', 'notes', 'permitted-development-rights', 'permitted-development-right']) {
    const value = entity[field];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
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

/**
 * Split the datasets that returned no entities into genuinely clear
 * (nationally complete data) vs "no data found" (partial-coverage datasets,
 * where absence of a hit must not be read as absence of a constraint).
 */
export function classifyChecked(
  checked: RegistryEntry[],
  hits: ScoredHit[],
  failedDatasets: string[],
): { clear: RegistryEntry[]; partialNoData: RegistryEntry[] } {
  const hitSlugs = new Set(hits.map((h) => h.registry.slug));
  const failed = new Set(failedDatasets);
  const noHit = checked.filter((c) => !hitSlugs.has(c.slug) && !failed.has(c.slug));
  return {
    clear: noHit.filter((c) => !c.partialCoverage),
    partialNoData: noHit.filter((c) => c.partialCoverage),
  };
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
