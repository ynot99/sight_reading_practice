import { describe, expect, it } from 'vitest';
import {
  takeWithTheLoudnessWritten,
  thePlayingAtAnotherPace,
  thePlayingWithABarInserted,
  writeMidiFile,
  type HeardBeat,
  type MidiFileEvent,
} from '../../src/domain/midi/MidiFile.js';
import { DRUM_KIT, THE_KITS_RANGE, theDrumOf, theNotesAndTheDrumsSwapped } from '../../src/domain/midi/drums.js';
import { sketchAsKept, sketchFromKept, type StoredSketch } from '../../src/application/SketchLibrary.js';
import { theKeysOfTheTake, thePlayingWithABarTakenOut } from '../../src/application/session/RunRoll.js';

const KICK = 36;
const SNARE = 37;

const hit = (midi: number, atMs: number, upAtMs = atMs + 100): MidiFileEvent[] => [
  { kind: 'drumOn', atMs, midi, velocity: 0.75 },
  { kind: 'drumOff', atMs: upAtMs, midi },
];
const key = (midi: number, atMs: number, upAtMs: number): MidiFileEvent[] => [
  { kind: 'noteOn', atMs, midi, velocity: 0.5, hand: 'right' },
  { kind: 'noteOff', atMs: upAtMs, midi },
];
/** A click of four in a bar, a beat every half second. */
const fours = (count: number): HeardBeat[] => Array.from({ length: count }, (_, at) => ({ atMs: at * 500, beat: at % 4, beatsInBar: 4 }));
const said = (events: readonly MidiFileEvent[]): string[] =>
  [...events]
    .sort((one, other) => one.atMs - other.atMs)
    .map((event) => `${String(event.atMs)} ${event.kind}${'midi' in event ? ` ${String(event.midi)}` : ''}`);

describe('the kit', () => {
  it('numbers its drums one after another, so every row of a drawing of them is a drum', () => {
    const numbers = DRUM_KIT.map((drum) => drum.midi);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, at) => THE_KITS_RANGE.low + at));
    expect(THE_KITS_RANGE.high).toBe(THE_KITS_RANGE.low + numbers.length - 1);
    expect(theDrumOf(KICK)?.short).toBe('Kick');
    expect(theDrumOf(THE_KITS_RANGE.high + 1)).toBeNull();
  });
});

describe('the notes and the drums changed places', () => {
  const playing: MidiFileEvent[] = [
    ...key(60, 0, 400),
    ...hit(KICK, 0),
    { kind: 'sustain', atMs: 10, value: 1 },
    { kind: 'key', atMs: 0, fifths: 1, scale: 'major' },
    { kind: 'dynamic', atMs: 0, level: 'f' },
    { kind: 'section', atMs: 0, name: 'A' },
  ];

  it('makes each drum a key and each key a drum, and leaves everything else as it was', () => {
    const swapped = theNotesAndTheDrumsSwapped(playing);
    expect(swapped.map((event) => event.kind)).toEqual(['drumOn', 'drumOff', 'noteOn', 'noteOff', 'sustain', 'key', 'dynamic', 'section']);
    expect(swapped[0]).toEqual({ kind: 'drumOn', atMs: 0, midi: 60, velocity: 0.5, hand: 'right' });
    expect(swapped.slice(4)).toEqual(playing.slice(4));
    // Their keys are the other's: the drawing of one finds the other's notes.
    expect(theKeysOfTheTake(swapped).map((each) => each.midi)).toEqual([KICK]);
    expect(theKeysOfTheTake(swapped, 'drums').map((each) => each.midi)).toEqual([60]);
  });

  it('is undone by doing it again', () => {
    expect(theNotesAndTheDrumsSwapped(theNotesAndTheDrumsSwapped(playing))).toEqual(playing);
  });
});

describe('the drums of a sketch kept', () => {
  it('are kept and read back as they were, beside its notes', () => {
    const sketch: StoredSketch = {
      id: 'one',
      title: 'One',
      begunAtMs: 0,
      events: [
        ...key(60, 0, 400),
        ...hit(KICK, 0),
        { kind: 'drumOn', atMs: 500, midi: SNARE, velocity: 0.75, loudness: { level: null, shade: 0 } },
        { kind: 'drumOff', atMs: 600, midi: SNARE },
      ],
      beats: fours(4),
      noteCount: 1,
      key: { fifths: 0, mode: 'major' },
    };
    const kept = sketchAsKept(sketch);
    const packed = kept['events'] as readonly (readonly unknown[])[];
    expect(packed.map((each) => each[0])).toEqual([0, 1, 6, 7, 6, 7]);
    const back = sketchFromKept(JSON.parse(JSON.stringify(kept)));
    expect(back?.events.map((event) => event.kind)).toEqual(sketch.events.map((event) => event.kind));
    expect(said(back?.events ?? [])).toEqual(said(sketch.events));
    // A drum is no note.
    expect(back?.noteCount).toBe(1);
  });
});

describe('the loops of drums kept', () => {
  it('are kept and read back edge by edge, and an edge not known is none', () => {
    const edges: MidiFileEvent[] = [
      { kind: 'drumLoop', atMs: 0, loop: 3, edge: 'from' },
      { kind: 'drumLoop', atMs: 2_000, loop: 3, edge: 'lap' },
      { kind: 'drumLoop', atMs: 5_000, loop: 3, edge: 'until' },
    ];
    const sketch: StoredSketch = {
      id: 'one',
      title: 'One',
      begunAtMs: 0,
      events: [...hit(KICK, 0), ...edges],
      beats: fours(4),
      noteCount: 0,
      key: { fifths: 0, mode: 'major' },
    };
    const kept = sketchAsKept(sketch);
    expect((kept['events'] as readonly (readonly unknown[])[]).slice(2)).toEqual([
      [8, 0, 3, 0],
      [8, 2_000, 3, 1],
      [8, 5_000, 3, 2],
    ]);
    expect(sketchFromKept(JSON.parse(JSON.stringify(kept)))?.events.slice(2)).toEqual(edges);
    const unknown = { ...kept, events: [[8, 0, 3, 7]] };
    expect(sketchFromKept(unknown)?.events).toEqual([]);
  });
});

describe('a sketch with drums written as a file', () => {
  it('leaves the drums out: the file is the one its notes alone make', () => {
    const notes = [...key(60, 0, 400), ...key(64, 500, 900)];
    const withDrums = [...notes, ...hit(KICK, 0), ...hit(SNARE, 500), ...hit(KICK, 700)];
    expect(writeMidiFile(withDrums, { beats: fours(4) })).toEqual(writeMidiFile(notes, { beats: fours(4) }));
    // And past the notes: a hit after the last of them lengthens nothing.
    expect(writeMidiFile([...withDrums, ...hit(KICK, 5_000)], { beats: fours(4) })).toEqual(writeMidiFile(notes, { beats: fours(4) }));
  });
});

describe('a drum written at a level', () => {
  it('is struck as hard as the level says, as a note is', () => {
    const events: MidiFileEvent[] = [
      { kind: 'dynamic', atMs: 0, level: 'ff' },
      { kind: 'drumOn', atMs: 0, midi: KICK, velocity: 0.1, loudness: { level: null, shade: 0 } },
      { kind: 'drumOff', atMs: 100, midi: KICK },
      { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.1, loudness: { level: null, shade: 0 } },
      { kind: 'noteOff', atMs: 100, midi: 60 },
    ];
    const written = takeWithTheLoudnessWritten(events);
    const velocityOf = (kind: string): number | undefined => {
      const found = written.find((event) => event.kind === kind);
      return found !== undefined && 'velocity' in found ? found.velocity : undefined;
    };
    expect(velocityOf('drumOn')).toBeGreaterThan(0.1);
    expect(velocityOf('drumOn')).toBe(velocityOf('noteOn'));
  });
});

describe('the drums under the music changed', () => {
  it('move with a bar put in: a hit on its bar line with the bar after, one before it where it was', () => {
    const events = [...key(60, 0, 1_900), ...hit(KICK, 1_500, 1_600), ...hit(SNARE, 2_000, 2_100), ...key(62, 2_000, 2_400)];
    const inserted = thePlayingWithABarInserted(events, fours(8), 2_000);
    expect(said(inserted.events)).toEqual([
      '0 noteOn 60',
      '1500 drumOn 36',
      '1600 drumOff 36',
      '1900 noteOff 60',
      '4000 drumOn 37',
      '4000 noteOn 62',
      '4100 drumOff 37',
      '4400 noteOff 62',
    ]);
  });

  it('go with a bar taken out where they are in it, and a hit ringing into it is let go of where it begins', () => {
    const events = [
      ...key(60, 0, 400),
      ...hit(KICK, 1_900, 2_300),
      ...hit(SNARE, 2_500),
      ...hit(KICK, 4_000),
      ...key(62, 4_000, 4_400),
    ];
    const taken = thePlayingWithABarTakenOut(events, fours(12), 2_500);
    expect(said(taken?.events ?? [])).toEqual([
      '0 noteOn 60',
      '400 noteOff 60',
      '1900 drumOn 36',
      '2000 drumOff 36',
      '2000 drumOn 36',
      '2000 noteOn 62',
      '2100 drumOff 36',
      '2400 noteOff 62',
    ]);
  });

  it('keep their place in the beat at another pace', () => {
    const paced = thePlayingAtAnotherPace([...key(60, 0, 400), ...hit(KICK, 250, 300)], fours(4), 60);
    expect(said(paced.events)).toEqual(['0 noteOn 60', '500 drumOn 36', '600 drumOff 36', '800 noteOff 60']);
  });

  it('are let go of before one struck again at the same moment, as a key is', () => {
    // Written struck first, as a list may come: put in order, the release goes first.
    const events = [...hit(KICK, 500, 600), ...hit(KICK, 0, 500), ...key(60, 0, 1_900)];
    const inserted = thePlayingWithABarInserted(events, fours(8), 2_000);
    const atFiveHundred = inserted.events.filter((event) => event.atMs === 500).map((event) => event.kind);
    expect(atFiveHundred).toEqual(['drumOff', 'drumOn']);
  });
});
