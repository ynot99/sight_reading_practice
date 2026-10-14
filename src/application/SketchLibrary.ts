import { barsAreHeardIn, type HeardBeat, type MidiFileEvent } from '../domain/midi/MidiFile.js';
import { barLines, elapsedMsAt, type Exercise } from '../domain/model/Exercise.js';
import type { ExerciseTimeline } from '../domain/timeline/Timeline.js';
import type { ISettingsStore } from './ports/ISettingsStore.js';
import { pack, packBeat, theBeatsIfWhole, unpack } from './packedPlaying.js';
import { rollAsEvents, rollBeganAtMs, rollOfTheScore } from './session/RunRoll.js';

/**
 * Music being written: notes on the bars of a click, to be changed until
 * they are what the writer meant, read as a score and saved as a file.
 *
 * Its own thing rather than a recording changed, because a recording is a
 * record of what was played, and something begun from one is a new piece of
 * music. Begun from a recording, it is a copy of it, and the recording stays
 * as it was played.
 */
export interface StoredSketch {
  readonly id: string;
  readonly title: string;
  /** Wall-clock moment it was begun, for naming and ordering. */
  readonly begunAtMs: number;
  readonly events: readonly MidiFileEvent[];
  /** The beats its bars are written in: see `theClickOfTheTake`. */
  readonly beats: readonly HeardBeat[];
  readonly noteCount: number;
  /** The key it is written in: C major unless it was begun from a score in another. */
  readonly key: SketchKey;
}

/** A key as a sketch keeps it: its sharps or flats, and whether it is minor. */
export interface SketchKey {
  readonly fifths: number;
  readonly mode: 'major' | 'minor';
}

/** The key of a sketch nothing gave one. */
export const C_MAJOR: SketchKey = { fifths: 0, mode: 'major' };

/** A key read back, where it is one a key signature can have. */
function readKey(value: unknown): SketchKey {
  if (!Array.isArray(value)) {
    return C_MAJOR;
  }
  const [fifths, minor] = value as readonly unknown[];
  return Number.isInteger(fifths) && (fifths as number) >= -7 && (fifths as number) <= 7
    ? { fifths: fifths as number, mode: minor === 1 ? 'minor' : 'major' }
    : C_MAJOR;
}

const STORAGE_VERSION = 1;

/**
 * The tempo and the bar a sketch is begun in where nothing says otherwise:
 * a recording played without the click. Common time at a moderate crotchet,
 * which is also what a sequencer opens a file in that says nothing.
 */
export const ASSUMED_BPM = 120;
export const ASSUMED_BEATS_IN_A_BAR = 4;

/**
 * The beats to begin a sketch of some playing in: the click it was played to,
 * or the assumed one from its first event, two beats being enough for the
 * rest to be carried on.
 */
export function theBeatsToBeginIn(
  events: readonly MidiFileEvent[],
  heard: readonly HeardBeat[],
): readonly HeardBeat[] {
  if (barsAreHeardIn(heard)) {
    return heard;
  }
  const first = events.reduce((earliest, event) => Math.min(earliest, event.atMs), Number.POSITIVE_INFINITY);
  const from = Number.isFinite(first) ? first : 0;
  return [0, 1].map((beat) => ({
    atMs: from + (beat * 60_000) / ASSUMED_BPM,
    beat,
    beatsInBar: ASSUMED_BEATS_IN_A_BAR,
  }));
}

/**
 * A score as something a sketch can be begun from: its notes as they sound,
 * pedal and loudness and all, and a beat on every beat of every bar, each of
 * the value its bar is written in - so a bar of six quavers is six quavers
 * and not three crotchets, and a change of tempo is where the beats say.
 */
export function theSketchOfTheScore(
  exercise: Exercise,
  timeline: ExerciseTimeline,
): { readonly events: readonly MidiFileEvent[]; readonly beats: readonly HeardBeat[] } {
  // The notes are the score's own drawing of itself, rebased as it plays them.
  const roll = rollOfTheScore(exercise, timeline);
  const origin = rollBeganAtMs(roll);
  const beats = barLines(exercise).flatMap(({ startTicks, timeSignature }) =>
    Array.from({ length: timeSignature.beats }, (_, beat) => ({
      atMs: elapsedMsAt(exercise, startTicks + beat * timeSignature.ticksPerBeat) - origin,
      beat,
      beatsInBar: timeSignature.beats,
      beatType: timeSignature.beatType,
    })),
  );
  return { events: rollAsEvents(roll), beats };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readSketch(value: unknown): StoredSketch | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, title, begunAtMs, events, beats, key } = value;
  if (typeof id !== 'string' || typeof title !== 'string' || typeof begunAtMs !== 'number' || !Array.isArray(events)) {
    return null;
  }
  const unpacked = events.map(unpack).filter((event): event is MidiFileEvent => event !== null);
  return sketchOf(id, title, begunAtMs, unpacked, theBeatsIfWhole(beats), readKey(key));
}

function sketchOf(
  id: string,
  title: string,
  begunAtMs: number,
  events: readonly MidiFileEvent[],
  beats: readonly HeardBeat[],
  key: SketchKey,
): StoredSketch {
  return {
    id,
    title,
    begunAtMs,
    events,
    beats,
    noteCount: events.filter((event) => event.kind === 'noteOn').length,
    key,
  };
}

/** The sketches being written, across visits. Kept until the writer deletes one. */
export class SketchLibrary {
  private readonly store: ISettingsStore;
  private sketches: StoredSketch[] = [];

  constructor(store: ISettingsStore) {
    this.store = store;
  }

  /** Reads what previous visits kept. A bad entry costs a sketch, not the app. */
  load(): void {
    const raw = this.store.read();
    this.sketches =
      isRecord(raw) && Array.isArray(raw['sketches'])
        ? raw['sketches'].map(readSketch).filter((sketch): sketch is StoredSketch => sketch !== null)
        : [];
  }

  /** Newest first: the one being worked on is almost always the last begun. */
  list(): readonly StoredSketch[] {
    return [...this.sketches].sort((left, right) => right.begunAtMs - left.begunAtMs);
  }

  find(id: string): StoredSketch | null {
    return this.sketches.find((sketch) => sketch.id === id) ?? null;
  }

  /**
   * Begins a sketch of some playing, a copy of it: in the bars of the click it
   * was played to, or in the assumed ones where there was none.
   */
  begin(
    playing: { readonly events: readonly MidiFileEvent[]; readonly beats: readonly HeardBeat[] },
    title: string,
    begunAtMs: number,
    key: SketchKey = C_MAJOR,
  ): StoredSketch {
    const sketch = sketchOf(
      this.unusedId(`sketch-${begunAtMs.toString(36)}`),
      title,
      begunAtMs,
      playing.events,
      theBeatsToBeginIn(playing.events, playing.beats),
      key,
    );
    this.sketches = [...this.sketches, sketch];
    this.persist();
    return sketch;
  }

  /**
   * Gives a sketch new notes, and new beats where they are given - another
   * metre, another pace: the same sketch changed, its name and key kept.
   */
  changeTheNotes(id: string, events: readonly MidiFileEvent[], beats?: readonly HeardBeat[]): StoredSketch | null {
    const found = this.find(id);
    if (found === null) {
      return null;
    }
    const changed = sketchOf(found.id, found.title, found.begunAtMs, events, beats ?? found.beats, found.key);
    this.sketches = this.sketches.map((sketch) => (sketch.id === id ? changed : sketch));
    this.persist();
    return changed;
  }

  /** Writes a sketch in another key: its notes are where they were, spelt in that key. */
  changeTheKey(id: string, key: SketchKey): StoredSketch | null {
    const found = this.find(id);
    if (found === null) {
      return null;
    }
    const changed = { ...found, key };
    this.sketches = this.sketches.map((sketch) => (sketch.id === id ? changed : sketch));
    this.persist();
    return changed;
  }

  /** Gives a sketch another name, its music as it was. */
  rename(id: string, title: string): StoredSketch | null {
    const found = this.find(id);
    if (found === null) {
      return null;
    }
    const changed = { ...found, title };
    this.sketches = this.sketches.map((sketch) => (sketch.id === id ? changed : sketch));
    this.persist();
    return changed;
  }

  remove(id: string): void {
    const before = this.sketches.length;
    this.sketches = this.sketches.filter((sketch) => sketch.id !== id);
    if (this.sketches.length !== before) {
      this.persist();
    }
  }

  /** The wanted id, or the nearest one nobody is using: two begun in one millisecond are two. */
  private unusedId(wanted: string): string {
    let candidate = wanted;
    for (let suffix = 2; this.find(candidate) !== null; suffix += 1) {
      candidate = `${wanted}-${suffix}`;
    }
    return candidate;
  }

  private persist(): void {
    this.store.write({
      version: STORAGE_VERSION,
      sketches: this.sketches.map((sketch) => ({
        id: sketch.id,
        title: sketch.title,
        begunAtMs: sketch.begunAtMs,
        events: sketch.events.map(pack),
        beats: sketch.beats.map(packBeat),
        key: [sketch.key.fifths, sketch.key.mode === 'minor' ? 1 : 0],
      })),
    });
  }
}
