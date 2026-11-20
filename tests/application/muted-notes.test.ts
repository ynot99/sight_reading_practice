import { describe, expect, it } from 'vitest';
import { withoutTheMuted, writeMidiFile, type MidiFileEvent } from '../../src/domain/midi/MidiFile.js';
import { pack, unpack } from '../../src/application/packedPlaying.js';
import {
  rollAsEvents,
  rollOfTheTake,
  takeWithTheChordsBroken,
  takeWithTheKeysChanged,
  takeWithTheKeysCopied,
  takeWithTheNotesPasted,
  theClipboardTextOf,
  theKeysOfTheTake,
  theNotesCopied,
  theNotesOnTheClipboard,
} from '../../src/application/session/RunRoll.js';
import { takeWithADrumLoop, takeWithTheDrumLoopsKeptInStep, takeWithTheDrumLoopUntil } from '../../src/domain/midi/drumLoops.js';

const note = (midi: number, atMs: number, upAtMs: number, muted = false): MidiFileEvent[] => [
  { kind: 'noteOn', atMs, midi, velocity: 0.5, ...(muted ? { muted: true as const } : {}) },
  { kind: 'noteOff', atMs: upAtMs, midi },
];

/** The keys as pitch, start and whether silenced. */
const keys = (events: readonly MidiFileEvent[]): string[] =>
  theKeysOfTheTake(events).map((key) => `${String(key.midi)}@${String(key.downAtMs)}${key.muted === true ? ' muted' : ''}`);

describe('a note silenced in the editor', () => {
  it('is left out of what is heard and written, with its own letting go, a key struck twice over keeping the right end', () => {
    // C struck at 0, again at 100 while down, the first silenced: the first
    // letting go is the silenced one's, the second the one heard.
    const events: MidiFileEvent[] = [
      { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.5, muted: true },
      { kind: 'noteOn', atMs: 100, midi: 60, velocity: 0.5 },
      { kind: 'noteOff', atMs: 200, midi: 60 },
      { kind: 'noteOff', atMs: 300, midi: 60 },
      { kind: 'drumOn', atMs: 0, midi: 60, velocity: 0.5 },
      { kind: 'drumOff', atMs: 50, midi: 60 },
      { kind: 'drumOn', atMs: 400, midi: 37, velocity: 0.5, muted: true },
      { kind: 'drumOff', atMs: 450, midi: 37 },
      { kind: 'sustain', atMs: 0, value: 1 },
    ];

    expect(withoutTheMuted(events)).toEqual([
      { kind: 'noteOn', atMs: 100, midi: 60, velocity: 0.5 },
      { kind: 'noteOff', atMs: 300, midi: 60 },
      { kind: 'drumOn', atMs: 0, midi: 60, velocity: 0.5 },
      { kind: 'drumOff', atMs: 50, midi: 60 },
      { kind: 'sustain', atMs: 0, value: 1 },
    ]);
  });

  it('goes into no file: the file is the one the rest make', () => {
    const rest = [...note(60, 0, 400), ...note(64, 500, 900)];
    const withIt = [...note(60, 0, 400), ...note(62, 200, 600, true), ...note(64, 500, 900)];

    expect(writeMidiFile(withIt)).toEqual(writeMidiFile(rest));
    // And one silenced last does not make the file longer.
    expect(writeMidiFile([...rest, ...note(67, 5_000, 6_000, true)])).toEqual(writeMidiFile(rest));
  });

  it('is kept silenced, with a hand and a loudness or with neither, and reads back so', () => {
    // A velocity a stored one can be: a step of 127.
    const V = 64 / 127;
    const struck: MidiFileEvent[] = [
      { kind: 'noteOn', atMs: 0, midi: 60, velocity: V, muted: true },
      { kind: 'noteOn', atMs: 0, midi: 60, velocity: V, hand: 'left', muted: true },
      { kind: 'noteOn', atMs: 0, midi: 60, velocity: V, loudness: { level: 'f', shade: 20 }, muted: true },
      { kind: 'noteOn', atMs: 0, midi: 60, velocity: V, hand: 'right', loudness: { level: null, shade: -10 }, muted: true },
      { kind: 'drumOn', atMs: 0, midi: 37, velocity: V, muted: true },
    ];
    for (const event of struck) {
      expect(unpack(pack(event))).toEqual(event);
    }
    // Heard, it is packed as it always was.
    expect(pack({ kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.5 })).toEqual([0, 0, 60, 64]);
    expect(pack({ kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.5, hand: 'left' })).toEqual([0, 0, 60, 64, 2]);
  });

  it('is a key of the take like any other, silenced or heard again by a change, left as it was where none is said', () => {
    const events = [...note(60, 0, 400), ...note(64, 0, 400)];
    const [c, e] = theKeysOfTheTake(events);
    if (c === undefined || e === undefined) {
      throw new Error('two keys');
    }

    const silenced = takeWithTheKeysChanged(events, [{ key: c, midi: 60, downAtMs: 0, upAtMs: 400, muted: true }]) ?? [];
    expect(keys(silenced)).toEqual(['60@0 muted', '64@0']);
    // Moved, it is still silenced.
    const [still] = theKeysOfTheTake(silenced);
    const moved = still === undefined ? [] : (takeWithTheKeysChanged(silenced, [{ key: still, midi: 62, downAtMs: 100, upAtMs: 500 }]) ?? []);
    expect(keys(moved)).toEqual(['64@0', '62@100 muted']);
    // Heard again.
    const [again] = theKeysOfTheTake(moved).filter((key) => key.muted === true);
    const heard = again === undefined ? [] : (takeWithTheKeysChanged(moved, [{ key: again, midi: 62, downAtMs: 100, upAtMs: 500, muted: false }]) ?? []);
    expect(keys(heard)).toEqual(['64@0', '62@100']);
  });

  it('is copied, put on the clipboard and pasted, and broken from a chord, silenced', () => {
    const events = [...note(60, 0, 1_000, true), ...note(64, 0, 1_000)];
    const named = [
      { midi: 60, downAtMs: 0 },
      { midi: 64, downAtMs: 0 },
    ];

    expect(keys(takeWithTheKeysCopied(events, named, 2_000, 0) ?? [])).toEqual(['60@0 muted', '64@0', '60@2000 muted', '64@2000']);
    const copied = theNotesCopied(events, named);
    expect(copied.map((each) => each.muted === true)).toEqual([true, false]);
    const onTheClipboard = theNotesOnTheClipboard(theClipboardTextOf(copied));
    expect(onTheClipboard?.map((each) => each.muted === true)).toEqual([true, false]);
    expect(keys(takeWithTheNotesPasted([], onTheClipboard ?? [], 3_000).events)).toEqual(['60@3000 muted', '64@3000']);
    // Broken up, in four steps of the grid: the silenced key's steps silenced.
    const broken = takeWithTheChordsBroken(events, named, [250, 500, 750], 'up');
    expect(keys(broken?.events ?? [])).toEqual(['60@0 muted', '64@250', '60@500 muted', '64@750']);
  });

  it('refuses a clipboard that says it is silenced in any way but yes', () => {
    const text = theClipboardTextOf([{ afterMs: 0, lengthMs: 100, midi: 60, velocity: 0.5 }]).replace('"velocity":0.5', '"velocity":0.5,"muted":false');

    expect(theNotesOnTheClipboard(text)).toBeNull();
  });

  it('is drawn among the notes, and not heard when the drawing is played', () => {
    const roll = rollOfTheTake({ events: [...note(60, 0, 400, true), ...note(64, 0, 400)], beats: [] });

    expect(roll.presses.map((press) => press.muted === true)).toEqual([true, false]);
    expect(rollAsEvents(roll).flatMap((event) => (event.kind === 'noteOn' ? [event.midi] : []))).toEqual([64]);
  });

  it('is silenced in every lap of a loop of drums, as any change to one lap is', () => {
    const drum = (atMs: number, muted = false): MidiFileEvent[] => [
      { kind: 'drumOn', atMs, midi: 36, velocity: 0.5, ...(muted ? { muted: true as const } : {}) },
      { kind: 'drumOff', atMs: atMs + 100, midi: 36 },
    ];
    const pulled = takeWithTheDrumLoopUntil(takeWithADrumLoop(drum(0), 0, 1_000) ?? [], 1, 3_000);
    const silencedInTheSecond = pulled.map((event) => (event.kind === 'drumOn' && event.atMs === 1_000 ? { ...event, muted: true as const } : event));

    const kept = takeWithTheDrumLoopsKeptInStep(pulled, silencedInTheSecond);

    expect(keys(withoutTheMuted(kept))).toEqual([]);
    expect(theKeysOfTheTake(kept, 'drums').map((each) => [each.downAtMs, each.muted === true])).toEqual([
      [0, true],
      [1_000, true],
      [2_000, true],
    ]);
    // Written out from a lap silenced, its copies are.
    const fromASilencedLap = takeWithTheDrumLoopUntil(takeWithADrumLoop(drum(0, true), 0, 1_000) ?? [], 1, 2_000);
    expect(theKeysOfTheTake(fromASilencedLap, 'drums').map((each) => each.muted === true)).toEqual([true, true]);
  });
});
