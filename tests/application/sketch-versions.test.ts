import { describe, expect, it } from 'vitest';
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';
import { SketchLibrary, type StoredSketch } from '../../src/application/SketchLibrary.js';
import { SketchVersions, VERSIONS_OF_A_SKETCH } from '../../src/application/SketchVersions.js';
import type { MidiFileEvent } from '../../src/domain/midi/MidiFile.js';

const BEATS = [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 }));

/** A sketch of one note a key up from C for each `keys`, so two of them are told apart by their notes. */
function aSketch(id: string, keys: number): StoredSketch {
  const library = new SketchLibrary(new InMemorySettingsStore(), () => 0);
  const events: MidiFileEvent[] = Array.from({ length: keys }, (_, at) => [
    { kind: 'noteOn' as const, atMs: at * 500, midi: 60 + at, velocity: 89 / 127 },
    { kind: 'noteOff' as const, atMs: at * 500 + 400, midi: 60 + at },
  ]).flat();
  return { ...library.begin({ events, beats: BEATS }, `Sketch ${id}`, 1), id };
}

describe('the versions kept of a sketch', () => {
  it('keeps each newest first, with when and why, and reads them back on the next visit', () => {
    const store = new InMemorySettingsStore();
    let now = 1_000;
    const versions = new SketchVersions(store, () => now);
    versions.keep(aSketch('a', 1), 'editing');
    now = 2_000;
    versions.keep(aSketch('a', 2), 'drive');
    now = 3_000;
    versions.keep(aSketch('b', 3), 'restoring');

    const said = (kept: SketchVersions, id: string): unknown[] =>
      kept.of(id).map((version) => [version.keptAtMs, version.why, version.sketch.noteCount]);
    expect(said(versions, 'a')).toEqual([
      [2_000, 'drive', 2],
      [1_000, 'editing', 1],
    ]);
    expect(said(versions, 'b')).toEqual([[3_000, 'restoring', 3]]);
    expect(versions.of('c')).toEqual([]);

    const again = new SketchVersions(store, () => 0);
    again.load();
    expect([said(again, 'a'), said(again, 'b')]).toEqual([said(versions, 'a'), said(versions, 'b')]);
    expect(again.of('a')[0]?.sketch).toEqual(versions.of('a')[0]?.sketch);
  });

  it('keeps a version once where it is the one kept last, and again after another', () => {
    const versions = new SketchVersions(new InMemorySettingsStore(), () => 0);
    versions.keep(aSketch('a', 1), 'editing');
    versions.keep(aSketch('a', 1), 'drive');
    expect(versions.of('a').map((version) => version.why)).toEqual(['editing']);
    versions.keep(aSketch('a', 2), 'editing');
    versions.keep(aSketch('a', 1), 'restoring');
    expect(versions.of('a').map((version) => version.sketch.noteCount)).toEqual([1, 2, 1]);
  });

  it('keeps at most so many of one sketch, the oldest going', () => {
    let now = 0;
    const versions = new SketchVersions(new InMemorySettingsStore(), () => now);
    for (let keys = 1; keys <= VERSIONS_OF_A_SKETCH + 3; keys += 1) {
      now = keys;
      versions.keep(aSketch('a', keys), 'editing');
    }
    const kept = versions.of('a').map((version) => version.sketch.noteCount);
    expect(kept).toHaveLength(VERSIONS_OF_A_SKETCH);
    expect([kept[0], kept[kept.length - 1]]).toEqual([VERSIONS_OF_A_SKETCH + 3, 4]);
  });

  it('lets the oldest of any sketch go where they would take more than their room, and writes no more than it', () => {
    // The oldest is of the sketch the newest is of too, and the other's one
    // version is between them.
    const kept = [['a', 8], ['a', 9], ['b', 10], ['a', 11]] as const;
    const keepAll = (versions: SketchVersions): void => {
      kept.forEach(([id, keys]) => {
        versions.keep(aSketch(id, keys), 'editing');
      });
    };
    // Room for all but one of them, measured on all four written down.
    const all = new InMemorySettingsStore();
    keepAll(new SketchVersions(all, () => 0));
    const room = Math.round(JSON.stringify(all.read()).length * 0.9);
    const store = new InMemorySettingsStore();
    let now = 0;
    const versions = new SketchVersions(store, () => (now += 1), room);
    keepAll(versions);
    const counts = (id: string): number[] => versions.of(id).map((version) => version.sketch.noteCount);
    expect([counts('a'), counts('b')]).toEqual([[11, 9], [10]]);
    expect(JSON.stringify(store.read()).length).toBeLessThanOrEqual(room);
  });

  it('keeps nothing of a version bigger than all their room, and stops there', () => {
    const store = new InMemorySettingsStore();
    const versions = new SketchVersions(store, () => 0, 10);
    versions.keep(aSketch('a', 3), 'editing');
    expect(versions.of('a')).toEqual([]);
    expect(store.read()).toEqual({ version: 1, sketches: { a: [] } });
  });

  it('lets every version of a sketch go with it', () => {
    const store = new InMemorySettingsStore();
    const versions = new SketchVersions(store, () => 0);
    versions.keep(aSketch('a', 1), 'editing');
    versions.keep(aSketch('b', 1), 'editing');
    versions.forget('a');
    expect([versions.of('a'), versions.of('b').length]).toEqual([[], 1]);
    const again = new SketchVersions(store, () => 0);
    again.load();
    expect([again.of('a'), again.of('b').length]).toEqual([[], 1]);
  });

  it('reads past a version that does not hold together', () => {
    const store = new InMemorySettingsStore();
    const versions = new SketchVersions(store, () => 5);
    versions.keep(aSketch('a', 1), 'editing');
    const written = store.read() as { sketches: Record<string, unknown[]> };
    const good = written.sketches['a']?.[0];
    store.write({
      version: 1,
      sketches: {
        a: [
          good,
          { at: 'then', why: 'editing', sketch: (good as { sketch: unknown }).sketch },
          { at: 1, why: 'no reason', sketch: (good as { sketch: unknown }).sketch },
          { at: 1, why: 'editing', sketch: {} },
          null,
        ],
        b: 'not a list',
        c: [{ at: 1, why: 'drive', sketch: null }],
      },
    });
    const again = new SketchVersions(store, () => 0);
    again.load();
    expect([again.of('a').length, again.of('b'), again.of('c')]).toEqual([1, [], []]);
    store.write('nonsense');
    again.load();
    expect(again.of('a')).toEqual([]);
  });
});

describe('a sketch kept as a version before something takes its place', () => {
  const rig = (): { readonly library: SketchLibrary; readonly versions: SketchVersions; readonly sketch: StoredSketch } => {
    const versions = new SketchVersions(new InMemorySettingsStore(), () => 7);
    const library = new SketchLibrary(new InMemorySettingsStore(), () => 0, versions);
    const sketch = library.begin({ events: aSketch('x', 2).events, beats: BEATS }, 'Kept', 1);
    return { library, versions, sketch };
  };

  it('before the drive takes its place, where the drive says anything else', () => {
    const { library, versions, sketch } = rig();
    library.takeFromTheDrive(sketch, 1);
    expect(versions.of(sketch.id)).toEqual([]);
    library.takeFromTheDrive({ ...sketch, events: aSketch('x', 3).events }, 2);
    expect(versions.of(sketch.id).map((version) => [version.why, version.sketch.noteCount])).toEqual([['drive', 2]]);
    // Brought here where there was none, nothing was here to keep.
    library.takeFromTheDrive({ ...aSketch('new', 1) }, 1);
    expect(versions.of('new')).toEqual([]);
  });

  it('before an earlier version is put back, whose music it takes under the name it has now', () => {
    const { library, versions, sketch } = rig();
    library.changeTheNotes(sketch.id, aSketch('x', 4).events);
    library.rename(sketch.id, 'Renamed');
    library.sentAt(sketch.id, 3);
    const earlier = { keptAtMs: 1, why: 'editing' as const, sketch: { ...aSketch('x', 1), key: { fifths: 2, mode: 'major' as const } } };
    const restored = library.restore(sketch.id, earlier);
    expect([restored?.title, restored?.noteCount, restored?.key.fifths]).toEqual(['Renamed', 1, 2]);
    expect(library.find(sketch.id)?.events).toEqual(earlier.sketch.events);
    // Kept as it was before, and to be sent: a change like any other.
    expect(versions.of(sketch.id).map((version) => [version.why, version.sketch.noteCount])).toEqual([['restoring', 4]]);
    expect(library.forTheDrive().find((here) => here.sketch.id === sketch.id)?.unsent).toBe(true);
    expect(library.restore('nobody', earlier)).toBeNull();
  });

  it('and every version of it let go of when it is taken off this device', () => {
    const { library, versions, sketch } = rig();
    library.takeFromTheDrive({ ...sketch, events: aSketch('x', 3).events }, 2);
    expect(versions.of(sketch.id)).toHaveLength(1);
    library.remove(sketch.id);
    expect(versions.of(sketch.id)).toEqual([]);
  });
});
