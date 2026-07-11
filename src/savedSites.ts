/**
 * Saved sites & re-check (BACKLOG-3). A consultant saves a checked location
 * with a snapshot of its constraints; re-checking later diffs the live result
 * against the snapshot — the platform gains data continuously as LPAs submit,
 * so "what changed since I looked?" is a real question.
 *
 * Everything lives in localStorage; nothing leaves the browser.
 */

export interface SavedSite {
  id: string;
  savedAt: string; // ISO date-time
  label: string;
  location:
    | { kind: 'point'; lat: number; lng: number }
    | { kind: 'site'; token: string }; // token = encodeSite() output
  /** Constraint entities present when saved (admin context excluded). */
  snapshot: { entity: number; label: string; name: string }[];
}

export interface RecheckDiff {
  savedAt: string;
  added: { entity: number; label: string; name: string }[];
  removed: { entity: number; label: string; name: string }[];
}

const STORAGE_KEY = 'plansheet-saved-v1';
const MAX_SAVED = 50;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike {
  return localStorage;
}

export function loadSavedSites(storage: StorageLike = defaultStorage()): SavedSite[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { schemaVersion?: number; sites?: SavedSite[] };
    return parsed.schemaVersion === 1 && Array.isArray(parsed.sites) ? parsed.sites : [];
  } catch {
    return [];
  }
}

function persist(sites: SavedSite[], storage: StorageLike): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, sites }));
  } catch {
    // storage full/unavailable — saving is best-effort
  }
}

/** Save (newest first, capped). Returns the updated list. */
export function saveSite(site: Omit<SavedSite, 'id' | 'savedAt'>, storage: StorageLike = defaultStorage()): SavedSite[] {
  const full: SavedSite = {
    ...site,
    id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    savedAt: new Date().toISOString(),
  };
  const sites = [full, ...loadSavedSites(storage)].slice(0, MAX_SAVED);
  persist(sites, storage);
  return sites;
}

export function deleteSite(id: string, storage: StorageLike = defaultStorage()): SavedSite[] {
  const sites = loadSavedSites(storage).filter((s) => s.id !== id);
  persist(sites, storage);
  return sites;
}

/**
 * Diff a saved snapshot against the entity ids of a fresh check. "Removed"
 * can also mean an entity was re-issued under a new id — flag it either way;
 * the consultant decides what it means.
 */
export function diffSnapshot(
  saved: SavedSite,
  currentConstraints: { entity: number; label: string; name: string }[],
): RecheckDiff {
  const savedIds = new Set(saved.snapshot.map((s) => s.entity));
  const currentIds = new Set(currentConstraints.map((c) => c.entity));
  return {
    savedAt: saved.savedAt,
    added: currentConstraints.filter((c) => !savedIds.has(c.entity)),
    removed: saved.snapshot.filter((s) => !currentIds.has(s.entity)),
  };
}
