/** An entity returned by GET /entity.json. Field names use hyphens, as served. */
export interface PlanningEntity {
  entity: number;
  name: string;
  dataset: string;
  reference: string;
  typology: string;
  'start-date': string;
  'end-date': string;
  'entry-date': string;
  'organisation-entity'?: string;
  prefix?: string;
  point?: string;
  /** Dataset-specific fields, e.g. listed-building-grade, flood-risk-level */
  [key: string]: unknown;
}

export interface EntityResponse {
  entities: PlanningEntity[];
  count: number;
  links?: Record<string, string>;
}

/** A dataset row from GET /dataset.json (loosely typed; we use a subset). */
export interface ApiDataset {
  dataset: string;
  name: string;
  typology: string;
  themes?: string[];
  'entity-count'?: number;
  plural?: string;
  [key: string]: unknown;
}

export interface DatasetResponse {
  datasets: ApiDataset[];
}

export type Category =
  | 'administrative'
  | 'heritage'
  | 'ecology'
  | 'flood'
  | 'landscape'
  | 'hazard'
  | 'local'
  | 'info'
  | 'other';

/** A dataset merged from the API list and the curated overlay. */
export interface RegistryEntry {
  slug: string;
  label: string;
  category: Category;
  /** 0–100 base severity; administrative entries are not scored. */
  impactScore: number;
  blurb?: string;
  /** True when the slug was not in the curated overlay (auto-included from the API). */
  unmapped?: boolean;
  /** LPA-sourced dataset with incomplete national coverage: zero hits ≠ clear. */
  partialCoverage?: boolean;
}

export interface LocationSelection {
  lat: number;
  lng: number;
  /** Human-readable origin of the selection, e.g. "SW1A 1AA" or "51.50140, -0.14190". */
  label?: string;
}

/** One constraint hit, scored and ready to render. */
export interface ScoredHit {
  entity: PlanningEntity;
  registry: RegistryEntry;
  /** Final score after per-entity modifiers (grade, flood level, …). */
  score: number;
  /** e.g. "Grade I" or "Flood Zone 3" — qualifier derived from entity fields. */
  qualifier?: string;
  /** Longer per-entity note, e.g. what an Article 4 direction removes. */
  detail?: string;
}

/** Everything the plan sheet renders — shared by the on-screen and Markdown views. */
export interface ReportData {
  selection: LocationSelection;
  nearestPostcode: string | null;
  /** Sorted hits: administrative first, then constraints by descending impact. */
  hits: ScoredHit[];
  /** Every dataset that was queried (for the affirmative "checked" record). */
  checked: RegistryEntry[];
  /** Dataset slugs whose query failed — these could NOT be checked. */
  failedDatasets: string[];
}

/** Machine-readable export of a plan sheet (SPEC-03). Stable, versioned schema. */
export interface PlansheetReport {
  schemaVersion: 1;
  generatedAt: string;
  location: {
    latitude: number;
    longitude: number;
    label: string | null;
    nearestPostcode: string | null;
  };
  administrative: { dataset: string; label: string; name: string; reference: string; entity: number; url: string }[];
  constraints: {
    dataset: string;
    label: string;
    name: string;
    reference: string;
    entity: number;
    url: string;
    category: Category;
    impactScore: number;
    impactTier: string;
    qualifier?: string;
    detail?: string;
    startDate?: string;
    entryDate?: string;
    organisation?: string;
  }[];
  /** LPA-sourced datasets with no hit: absence of data, NOT confirmation of no constraint. */
  coverageIncomplete: { dataset: string; label: string }[];
  /** Nationally-complete datasets with no hit — genuinely clear. */
  checkedClear: { dataset: string; label: string }[];
  /** Datasets whose query failed and could not be checked. */
  couldNotCheck: string[];
  /** Constraint classes the Planning Data platform does not hold at all. */
  notCovered: { topic: string; why: string; whereToCheck: string }[];
  disclaimer: string;
}
