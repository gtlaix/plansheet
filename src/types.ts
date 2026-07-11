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
  /** From /dataset.json, when present: how many entities the platform holds. */
  entityCount?: number;
  /** From /dataset.json, when present: when the dataset was last updated. */
  dataDate?: string;
}

export interface LocationSelection {
  lat: number;
  lng: number;
  /** Human-readable origin of the selection, e.g. "SW1A 1AA" or "51.50140, -0.14190". */
  label?: string;
}

/** A drawn/imported site boundary checked by geometry rather than a point (SPEC-01). */
export interface SiteBoundary {
  geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  /** Site area in square metres (spherical approximation). */
  areaM2: number;
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

/** A constraint near (not on) the site, found by a proximity scan (SPEC-04). */
export interface NearbyHit extends ScoredHit {
  /** Minimum boundary-to-boundary distance in metres (approximate). */
  distanceM: number;
  /** 16-wind compass direction from the site centre, e.g. "NE". */
  bearing: string;
}

/** Everything the plan sheet renders — shared by the on-screen and Markdown views. */
export interface ReportData {
  selection: LocationSelection;
  /** Present when the check was for a drawn/imported site boundary, not a point. */
  site?: SiteBoundary;
  /** Present after a proximity scan: constraints within the radius (SPEC-04). */
  nearby?: {
    radiusM: number;
    hits: NearbyHit[];
    /** Datasets skipped on wide scans to keep results useful. */
    skippedDense: string[];
  };
  /** Per-entity % of the site covered (polygon checks; null = coverage n/a). */
  coverage?: Map<number, { pct: number; areaM2: number } | null>;
  /** Present when this check re-ran a saved site: what changed since. */
  recheck?: {
    savedAt: string;
    added: { entity: number; label: string; name: string }[];
    removed: { entity: number; label: string; name: string }[];
  };
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
  /** Present for site-boundary (polygon) checks: the site geometry and its area. */
  site?: {
    areaSquareMetres: number;
    areaHectares: number;
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
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
    /** Polygon checks only: how much of the site this constraint covers. */
    siteCoverage?: { percent: number; areaSquareMetres: number } | 'n/a';
  }[];
  /** Constraints near (not on) the site from a proximity scan, if one was run. */
  nearby?: {
    radiusMetres: number;
    skippedDatasets: string[];
    hits: {
      dataset: string;
      label: string;
      name: string;
      entity: number;
      url: string;
      category: Category;
      impactScore: number;
      impactTier: string;
      distanceMetres: number;
      bearing: string;
      qualifier?: string;
    }[];
  };
  /** LPA-sourced datasets with no hit: absence of data, NOT confirmation of no constraint. */
  coverageIncomplete: { dataset: string; label: string }[];
  /** Nationally-complete datasets with no hit — genuinely clear. */
  checkedClear: { dataset: string; label: string; entityCount?: number; dataDate?: string }[];
  /** Datasets whose query failed and could not be checked. */
  couldNotCheck: string[];
  /** Constraint classes the Planning Data platform does not hold at all. */
  notCovered: { topic: string; why: string; whereToCheck: string }[];
  disclaimer: string;
}
