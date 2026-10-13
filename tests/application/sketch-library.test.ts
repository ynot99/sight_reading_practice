import { describe, expect, it } from 'vitest';
import {
  ASSUMED_BEATS_IN_A_BAR,
  ASSUMED_BPM,
  SketchLibrary,
  theBeatsToBeginIn,
} from '../../src/application/SketchLibrary.js';
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';
import type { HeardBeat, MidiFileEvent } from '../../src/domain/midi/MidiFile.js';

// A velocity the stored form of 127 steps gives back exactly.
const on = (atMs: number, midi: number): MidiFileEvent => ({ kind: 'noteOn', atMs, midi, velocity: 89 / 127 });
const off = (atMs: number, midi: number): MidiFileEvent => ({ kind: 'noteOff', atMs, midi });
const PLAYED: readonly MidiFileEvent[] = [on(0, 60), off(300, 60), on(500, 64), off(800, 64)];
const THREE: readonly HeardBeat[] = [
  { atMs: -100, beat: 0, beatsInBar: 3 },
  { atMs: 500, beat: 1, beatsInBar: 3 },
];

describe('the bars a sketch is begun in', () => {
  it('are the click the playing was heard against, where there was one', () => {
    expect(theBeatsToBeginIn(PLAYED, THREE)).toBe(THREE);
  });

  it('are common time at a moderate crotchet from the first thing played, where there was none', () => {
    expect([ASSUMED_BPM, ASSUMED_BEATS_IN_A_BAR]).toEqual([120, 4]);
    const late = PLAYED.map((event) => ({ ...event, atMs: event.atMs + 250 }));
    for (const heard of [[], [{ atMs: 0, beat: 0, beatsInBar: 3 }]]) {
      expect(theBeatsToBeginIn(late, heard)).toEqual([
        { atMs: 250, beat: 0, beatsInBar: 4 },
        { atMs: 750, beat: 1, beatsInBar: 4 },
      ]);
    }
    expect(theBeatsToBeginIn([], [])[0]?.atMs).toBe(0);
  });
});

describe('the sketches being written', () => {
  it('begins one as a copy of what was played, kept across visits, newest first', () => {
    const store = new InMemorySettingsStore();
    const library = new SketchLibrary(store);
    const first = library.begin({ events: PLAYED, beats: THREE }, 'An idea', 1_000);
    const second = library.begin({ events: PLAYED.slice(0, 2), beats: [] }, 'Another', 1_000);

    const next = new SketchLibrary(store);
    next.load();

    expect(second.id).not.toBe(first.id);
    expect(next.list().map((sketch) => [sketch.title, sketch.noteCount])).toEqual([
      ['An idea', 2],
      ['Another', 1],
    ]);
    expect(next.find(first.id)).toEqual(first);
    expect(next.find(second.id)?.beats).toEqual(theBeatsToBeginIn(PLAYED.slice(0, 2), []));
  });

  it('puts the one begun last first', () => {
    const library = new SketchLibrary(new InMemorySettingsStore());
    library.begin({ events: PLAYED, beats: THREE }, 'Older', 1_000);
    library.begin({ events: PLAYED, beats: THREE }, 'Newer', 2_000);

    expect(library.list().map((sketch) => sketch.title)).toEqual(['Newer', 'Older']);
  });

  it('changes the notes of one in place, its name and bars kept, across visits', () => {
    const store = new InMemorySettingsStore();
    const library = new SketchLibrary(store);
    const begun = library.begin({ events: PLAYED, beats: THREE }, 'An idea', 1_000);

    const changed = library.changeTheNotes(begun.id, PLAYED.slice(2));
    const next = new SketchLibrary(store);
    next.load();

    for (const found of [changed, next.find(begun.id)]) {
      expect(found).toEqual({ ...begun, events: PLAYED.slice(2), noteCount: 1 });
    }
    expect(next.list()).toHaveLength(1);
    expect(library.changeTheNotes('sketch-nobody', PLAYED)).toBeNull();
  });

  it('deletes one, and keeps that across visits', () => {
    const store = new InMemorySettingsStore();
    const library = new SketchLibrary(store);
    const begun = library.begin({ events: PLAYED, beats: THREE }, 'An idea', 1_000);
    library.begin({ events: PLAYED, beats: THREE }, 'Another', 2_000);

    library.remove(begun.id);
    const next = new SketchLibrary(store);
    next.load();

    expect(next.list().map((sketch) => sketch.title)).toEqual(['Another']);
  });

  it('reads past an entry it cannot, and nothing out of nothing', () => {
    const store = new InMemorySettingsStore();
    store.write({
      version: 1,
      sketches: [
        'not one',
        null,
        { id: 'a', title: 'Fine', begunAtMs: 1, events: [[0, 0, 60, 90]], beats: [] },
        { id: 'b', title: 7, begunAtMs: 1, events: [] },
        { id: 'c', title: 'No time', events: [] },
        { id: 'd', title: 'No notes', begunAtMs: 1 },
      ],
    });
    const library = new SketchLibrary(store);
    library.load();
    expect(library.list().map((sketch) => sketch.id)).toEqual(['a']);

    const empty = new SketchLibrary(new InMemorySettingsStore());
    empty.load();
    expect(empty.list()).toEqual([]);
  });
});
