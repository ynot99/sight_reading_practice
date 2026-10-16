import { describe, expect, it } from 'vitest';
import {
  ASSUMED_BEATS_IN_A_BAR,
  ASSUMED_BPM,
  C_MAJOR,
  SketchLibrary,
  theBeatsToBeginIn,
} from '../../src/application/SketchLibrary.js';
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';
import { theSketchOfTheScore } from '../../src/application/SketchLibrary.js';
import { readMidiFile } from '../../src/domain/midi/readMidiFile.js';
import { writeMidiFile } from '../../src/domain/midi/MidiFile.js';
import { midiToExercise } from '../../src/domain/notation/midiToExercise.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { compoundBarExercise } from '../support/fixtures.js';
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

describe('a sketch of a score', () => {
  it('has its notes as they sound and a beat on every beat of its bars, of their own value, and is written down as it was', () => {
    const score = compoundBarExercise();
    const { events, beats } = theSketchOfTheScore(score, buildTimeline(score));

    expect(beats.map((beat) => [beat.beat, beat.beatsInBar, beat.beatType])).toEqual(
      [0, 1, 2, 3, 4, 5].map((beat) => [beat, 6, 8]),
    );
    const gaps = beats.slice(1).map((beat, at) => beat.atMs - (beats[at]?.atMs ?? 0));
    expect(new Set(gaps).size).toBe(1);
    expect(beats[0]?.atMs).toBe(0);
    expect(events.filter((event) => event.kind === 'noteOn').map((event) => (event.kind === 'noteOn' ? event.midi : 0))).toEqual(
      [48, 60, 62, 64, 65, 67, 69],
    );

    const page = midiToExercise(readMidiFile(writeMidiFile(events, { beats })), 'Again').exercise;
    expect(page.timeSignature.toString()).toBe('6/8');
    const treble = buildTimeline(page).steps.flatMap((step) => (step.expectedMidi.some((midi) => midi >= 60) ? [step.onsetTicks] : []));
    expect(treble).toEqual([0, 1, 2, 3, 4, 5].map((at) => at * Duration.EIGHTH.ticks));
  });
});

describe('the sketches being written', () => {
  it('begins one as a copy of what was played, kept across visits, newest first', () => {
    const store = new InMemorySettingsStore();
    const library = new SketchLibrary(store, () => 0);
    const first = library.begin({ events: PLAYED, beats: THREE }, 'An idea', 1_000);
    const second = library.begin({ events: PLAYED.slice(0, 2), beats: [] }, 'Another', 1_000);

    const next = new SketchLibrary(store, () => 0);
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
    const library = new SketchLibrary(new InMemorySettingsStore(), () => 0);
    library.begin({ events: PLAYED, beats: THREE }, 'Older', 1_000);
    library.begin({ events: PLAYED, beats: THREE }, 'Newer', 2_000);

    expect(library.list().map((sketch) => sketch.title)).toEqual(['Newer', 'Older']);
  });

  it('changes the notes of one in place, its name and bars kept, across visits', () => {
    const store = new InMemorySettingsStore();
    const library = new SketchLibrary(store, () => 0);
    const begun = library.begin({ events: PLAYED, beats: THREE }, 'An idea', 1_000);

    const changed = library.changeTheNotes(begun.id, PLAYED.slice(2));
    const next = new SketchLibrary(store, () => 0);
    next.load();

    for (const found of [changed, next.find(begun.id)]) {
      expect(found).toEqual({ ...begun, events: PLAYED.slice(2), noteCount: 1 });
    }
    expect(next.list()).toHaveLength(1);
    expect(library.changeTheNotes('sketch-nobody', PLAYED)).toBeNull();
  });

  it('keeps the value of each beat across visits, and drops a click whose value is not one', () => {
    const store = new InMemorySettingsStore();
    const quavers = THREE.map((beat) => ({ ...beat, beatType: 8 }));
    const begun = new SketchLibrary(store, () => 0).begin({ events: PLAYED, beats: quavers }, 'In eights', 1_000);
    const next = new SketchLibrary(store, () => 0);
    next.load();
    expect(next.find(begun.id)?.beats).toEqual(quavers);

    store.write({ version: 1, sketches: [{ id: 'a', title: 'Odd', begunAtMs: 1, events: [[0, 0, 60, 90]], beats: [[0, 0, 3, 8], [500, 1, 3, 3]] }] });
    next.load();
    expect(next.find('a')?.beats).toEqual([]);
  });

  it('keeps the hand a note is said to be played by across visits, and no hand it cannot read', () => {
    const store = new InMemorySettingsStore();
    const handed: MidiFileEvent[] = [
      { kind: 'noteOn', atMs: 0, midi: 72, velocity: 89 / 127, hand: 'left' },
      { kind: 'noteOn', atMs: 0, midi: 48, velocity: 89 / 127, hand: 'right' },
      { kind: 'noteOn', atMs: 0, midi: 60, velocity: 89 / 127 },
    ];
    const begun = new SketchLibrary(store, () => 0).begin({ events: handed, beats: THREE }, 'Hands', 1);
    const next = new SketchLibrary(store, () => 0);
    next.load();
    expect(next.find(begun.id)?.events).toEqual(handed);

    store.write({ version: 1, sketches: [{ id: 'a', title: 'Odd', begunAtMs: 1, events: [[0, 0, 60, 89, 3]], beats: [] }] });
    next.load();
    expect(next.find('a')?.events).toEqual([{ kind: 'noteOn', atMs: 0, midi: 60, velocity: 89 / 127 }]);
  });

  it('keeps the key a sketch is written in across visits, C major where none was given', () => {
    const store = new InMemorySettingsStore();
    const library = new SketchLibrary(store, () => 0);
    const plain = library.begin({ events: PLAYED, beats: THREE }, 'Plain', 1);
    const minor = library.begin({ events: PLAYED, beats: THREE }, 'Minor', 2, { fifths: -3, mode: 'minor' });
    expect([plain.key, minor.key]).toEqual([C_MAJOR, { fifths: -3, mode: 'minor' }]);
    expect(C_MAJOR).toEqual({ fifths: 0, mode: 'major' });

    expect(library.changeTheKey(plain.id, { fifths: 6, mode: 'major' })?.key).toEqual({ fifths: 6, mode: 'major' });
    const between = new SketchLibrary(store, () => 0);
    between.load();
    expect(between.find(plain.id)?.key).toEqual({ fifths: 6, mode: 'major' });
    expect(library.changeTheNotes(plain.id, PLAYED.slice(2))?.key).toEqual({ fifths: 6, mode: 'major' });
    expect(library.changeTheKey('sketch-nobody', C_MAJOR)).toBeNull();
    const next = new SketchLibrary(store, () => 0);
    next.load();
    expect([next.find(plain.id)?.key, next.find(minor.id)?.key]).toEqual([
      { fifths: 6, mode: 'major' },
      { fifths: -3, mode: 'minor' },
    ]);

    for (const key of [undefined, 'D', [8, 0], [1.5, 0], ['1', 0]]) {
      store.write({ version: 1, sketches: [{ id: 'a', title: 'Odd', begunAtMs: 1, events: [], beats: [], key }] });
      next.load();
      expect(next.find('a')?.key, JSON.stringify(key)).toEqual(C_MAJOR);
    }
  });

  it('keeps the beats a sketch is counted in across visits, its notes as they were', () => {
    const store = new InMemorySettingsStore();
    const library = new SketchLibrary(store, () => 0);
    const sketch = library.begin({ events: PLAYED, beats: THREE }, 'Plain', 1);
    const inTwo: readonly HeardBeat[] = [
      { atMs: -100, beat: 0, beatsInBar: 2, beatType: 8 },
      { atMs: 200, beat: 1, beatsInBar: 2, beatType: 8 },
    ];

    expect(library.changeTheNotes(sketch.id, PLAYED, inTwo)?.beats).toEqual(inTwo);
    expect(library.changeTheNotes('sketch-nobody', PLAYED, inTwo)).toBeNull();
    const next = new SketchLibrary(store, () => 0);
    next.load();
    expect(next.find(sketch.id)?.beats).toEqual(inTwo);
    expect(next.find(sketch.id)?.events).toEqual(PLAYED);
  });

  it('renames one, its music as it was, and keeps the name across visits', () => {
    const store = new InMemorySettingsStore();
    const library = new SketchLibrary(store, () => 0);
    const sketch = library.begin({ events: PLAYED, beats: THREE }, 'Sketch, 14.10.2026', 1, { fifths: 2, mode: 'major' });

    const renamed = library.rename(sketch.id, 'Waltz in A');
    expect(renamed).toEqual({ ...sketch, title: 'Waltz in A' });
    expect(library.rename('sketch-nobody', 'Nobody')).toBeNull();
    const next = new SketchLibrary(store, () => 0);
    next.load();
    expect(next.find(sketch.id)?.title).toBe('Waltz in A');
  });

  it('deletes one, and keeps that across visits', () => {
    const store = new InMemorySettingsStore();
    const library = new SketchLibrary(store, () => 0);
    const begun = library.begin({ events: PLAYED, beats: THREE }, 'An idea', 1_000);
    library.begin({ events: PLAYED, beats: THREE }, 'Another', 2_000);

    library.remove(begun.id);
    const next = new SketchLibrary(store, () => 0);
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
    const library = new SketchLibrary(store, () => 0);
    library.load();
    expect(library.list().map((sketch) => sketch.id)).toEqual(['a']);

    const empty = new SketchLibrary(new InMemorySettingsStore(), () => 0);
    empty.load();
    expect(empty.list()).toEqual([]);
  });
});

describe('what a sync of the sketches needs kept beside them', () => {
  /** A library on a store, with a clock the test moves, and another visit to the same store. */
  function aLibrary(): { library: SketchLibrary; at: (ms: number) => void; again: () => SketchLibrary } {
    const store = new InMemorySettingsStore();
    let now = 0;
    const library = new SketchLibrary(store, () => now);
    return {
      library,
      at: (ms) => {
        now = ms;
      },
      again: () => {
        const next = new SketchLibrary(store, () => now);
        next.load();
        return next;
      },
    };
  }
  const state = (library: SketchLibrary): (string | number | boolean)[][] =>
    library.forTheDrive().map(({ sketch, revision, unsent }) => [sketch.id, revision, unsent]);

  it('counts each sketch unsent from its beginning to its sending, and again from each change', () => {
    const { library, at, again } = aLibrary();
    expect(library.unsentSinceMs).toBeNull();
    at(5_000);
    const begun = library.begin({ events: PLAYED, beats: THREE }, 'An idea', 1_000);
    expect(state(library)).toEqual([[begun.id, 0, true]]);
    expect(library.unsentSinceMs).toBe(5_000);

    library.sentAt(begun.id, 1);
    expect(state(library)).toEqual([[begun.id, 1, false]]);
    expect(library.unsentSinceMs).toBeNull();

    // Each kind of change, each from when it was made.
    const changes: [number, () => void][] = [
      [6_000, () => library.changeTheNotes(begun.id, PLAYED.slice(0, 2))],
      [7_000, () => library.changeTheKey(begun.id, { fifths: 2, mode: 'major' })],
      [8_000, () => library.rename(begun.id, 'Renamed')],
    ];
    for (const [ms, change] of changes) {
      at(ms);
      change();
      expect(state(library)).toEqual([[begun.id, 1, true]]);
      expect(library.unsentSinceMs).toBe(ms);
      expect(state(again())).toEqual([[begun.id, 1, true]]);
      expect(again().unsentSinceMs).toBe(ms);
      library.sentAt(begun.id, 1);
    }
    // Sent, kept in step across visits too.
    expect(state(again())).toEqual([[begun.id, 1, false]]);
  });

  it('takes a sketch off this device only, with nothing left unsent of it', () => {
    const { library, again } = aLibrary();
    const sent = library.begin({ events: PLAYED, beats: THREE }, 'Sent', 1_000);
    const unsent = library.begin({ events: PLAYED, beats: THREE }, 'Unsent', 2_000);
    library.sentAt(sent.id, 3);

    library.remove(unsent.id);
    expect(library.unsentSinceMs).toBeNull();
    library.remove(sent.id);
    library.remove('nowhere');
    expect(state(library)).toEqual([]);
    expect(state(again())).toEqual([]);
    // Brought back, it is in step with the drive again, not still at the old revision.
    library.takeFromTheDrive(sent, 5);
    expect(state(library)).toEqual([[sent.id, 5, false]]);
  });

  it('takes a sketch from the drive over the one here or beside them, in step with it', () => {
    const { library, again } = aLibrary();
    const mine = library.begin({ events: PLAYED, beats: THREE }, 'Mine', 1_000);

    library.takeFromTheDrive({ ...mine, title: 'Theirs', events: PLAYED.slice(0, 2), noteCount: 99 }, 4);
    const over = library.find(mine.id);
    expect([over?.title, over?.noteCount]).toEqual(['Theirs', 1]);
    library.takeFromTheDrive({ ...mine, id: 'brought', title: 'Brought' }, 2);
    expect(state(again()).sort()).toEqual([
      ['brought', 2, false],
      [mine.id, 4, false],
    ]);
    expect(library.list().map((sketch) => sketch.title).sort()).toEqual(['Brought', 'Theirs']);
  });

  it('keeps a copy of one under a new id and name, never yet sent', () => {
    const { library, again } = aLibrary();
    const kept = library.begin({ events: PLAYED, beats: THREE }, 'Kept', 2_000);
    library.sentAt(kept.id, 5);

    const copy = library.keepACopy(kept.id, 'Kept (conflicting copy)');
    const second = library.keepACopy(kept.id, 'Kept (another)');
    expect([copy?.id, second?.id]).toEqual([`${kept.id}-copy`, `${kept.id}-copy-2`]);
    expect(copy?.events).toEqual(kept.events);
    expect(state(library).filter(([id]) => id === copy?.id)).toEqual([[copy?.id ?? '', 0, true]]);
    expect(state(again()).sort()).toEqual([
      [kept.id, 5, false],
      [`${kept.id}-copy`, 0, true],
      [`${kept.id}-copy-2`, 0, true],
    ]);
    expect(library.keepACopy('nowhere', 'x')).toBeNull();
  });

  it('reads a sketch kept before there was a drive as never sent, and past what it cannot read', () => {
    const store = new InMemorySettingsStore();
    const sketch = (id: string, more: Record<string, unknown> = {}) => ({
      id,
      title: id,
      begunAtMs: 1,
      events: [],
      beats: [],
      ...more,
    });
    store.write({
      version: 1,
      sketches: [
        sketch('old'),
        sketch('sent', { revision: 3 }),
        sketch('changed', { revision: 2, unsent: 1 }),
        sketch('bad', { revision: 1.5 }),
        sketch('negative', { revision: -2, unsent: 0 }),
      ],
      changedAtMs: 'soon',
    });
    const library = new SketchLibrary(store, () => 0);
    library.load();

    expect(state(library)).toEqual([
      ['old', 0, true],
      ['sent', 3, false],
      ['changed', 2, true],
      ['bad', 0, true],
      ['negative', 0, true],
    ]);
    expect(library.unsentSinceMs).toBe(0);
  });
});
