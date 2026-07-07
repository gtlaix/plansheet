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
  /** Human-readable origin of the selection, e.g. "SW1A 1AA" or "UPRN 100023336956". */
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
}
