import { describe, expect, it } from 'vitest';
import { deleteSite, diffSnapshot, loadSavedSites, saveSite, type SavedSite } from '../src/savedSites';

function fakeStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
  };
}

const SNAPSHOT = [
  { entity: 201, label: 'Listed building', name: 'Buckingham Palace' },
  { entity: 203, label: 'Conservation area', name: 'Whitehall' },
];

describe('saved sites storage', () => {
  it('round-trips a saved point site, newest first', () => {
    const storage = fakeStorage();
    saveSite({ label: 'SW1A 1AA', location: { kind: 'point', lat: 51.5, lng: -0.14 }, snapshot: SNAPSHOT }, storage);
    const sites = saveSite({ label: 'Second', location: { kind: 'site', token: 'abc' }, snapshot: [] }, storage);
    expect(sites).toHaveLength(2);
    expect(sites[0].label).toBe('Second');

    const loaded = loadSavedSites(storage);
    expect(loaded[1].label).toBe('SW1A 1AA');
    expect(loaded[1].location).toEqual({ kind: 'point', lat: 51.5, lng: -0.14 });
    expect(loaded[1].snapshot).toEqual(SNAPSHOT);
    expect(loaded[0].id).not.toBe(loaded[1].id);
  });

  it('deletes by id and tolerates corrupt storage', () => {
    const storage = fakeStorage();
    const [saved] = saveSite({ label: 'X', location: { kind: 'point', lat: 51, lng: 0 }, snapshot: [] }, storage);
    expect(deleteSite(saved.id, storage)).toHaveLength(0);

    storage.setItem('plansheet-saved-v1', '{corrupt');
    expect(loadSavedSites(storage)).toEqual([]);
  });
});

describe('diffSnapshot', () => {
  const saved: SavedSite = {
    id: 's1',
    savedAt: '2026-07-01T00:00:00Z',
    label: 'Test',
    location: { kind: 'point', lat: 51.5, lng: -0.14 },
    snapshot: SNAPSHOT,
  };

  it('reports no changes for an identical result', () => {
    const diff = diffSnapshot(saved, SNAPSHOT);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  it('flags new and no-longer-returned constraints', () => {
    const current = [
      SNAPSHOT[0], // palace still there
      { entity: 999, label: 'Flood risk zone', name: 'Zone 2' }, // new
    ];
    const diff = diffSnapshot(saved, current);
    expect(diff.added.map((a) => a.entity)).toEqual([999]);
    expect(diff.removed.map((r) => r.entity)).toEqual([203]); // conservation area gone
    expect(diff.savedAt).toBe('2026-07-01T00:00:00Z');
  });
});
