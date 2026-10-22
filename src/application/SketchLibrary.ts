import { barsAreHeardIn, takeWithTheLoudnessWritten, type HeardBeat, type MidiFileEvent } from '../domain/midi/MidiFile.js';
import { barLines, DYNAMIC_LEVELS, DYNAMIC_VELOCITY, elapsedMsAt, type Exercise } from '../domain/model/Exercise.js';
import type { ExerciseTimeline } from '../domain/timeline/Timeline.js';
import { eachKeyOnce, sameKeys, theChordsMerged } from '../domain/harmony/chordsOfTheKey.js';
import { SCALES, isAScale, type ScaleName } from '../domain/harmony/scales.js';
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
  /**
   * The scale it is in, where it is other than the mode's own - a dorian, a
   * harmonic minor - written with the signature `fifths` says: see `SCALES`.
   * Then `mode` is whether that scale's third is minor.
   */
  readonly scale?: ScaleName;
}

/** The scale a sketch is written in: the one it says, or its mode's own. */
export function theScaleOfTheKey(key: SketchKey): ScaleName {
  return key.scale ?? key.mode;
}

/** A sketch's key in a scale, written with a signature: the mode the scale's third says, the scale kept where it is not the mode's own. */
export function aKeyInTheScale(fifths: number, scale: ScaleName): SketchKey {
  const mode = SCALES[scale].minor ? 'minor' : 'major';
  return scale === mode ? { fifths, mode } : { fifths, mode, scale };
}

/** The key of a sketch nothing gave one. */
export const C_MAJOR: SketchKey = { fifths: 0, mode: 'major' };

/**
 * Kept chords read back, each its keys once, low to high: a chord of fewer
 * than two keys, or of a key no keyboard has, is left out. `null` where
 * there is no list at all - which a sync tells apart from an empty one.
 */
export function readTheChords(raw: unknown): (readonly number[])[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  return (raw as unknown[]).flatMap((chord) => {
    const keys = Array.isArray(chord) ? (chord as unknown[]) : [];
    const fit = keys.every((midi) => Number.isInteger(midi) && (midi as number) >= 0 && (midi as number) <= 127);
    const once = eachKeyOnce(keys as number[]);
    return fit && once.length >= 2 ? [once] : [];
  });
}

/** A key read back, where it is one a key signature can have, in the scale it says where it says one. */
function readKey(value: unknown): SketchKey {
  if (!Array.isArray(value)) {
    return C_MAJOR;
  }
  const [fifths, minor, scale] = value as readonly unknown[];
  if (!Number.isInteger(fifths) || (fifths as number) < -7 || (fifths as number) > 7) {
    return C_MAJOR;
  }
  return isAScale(scale) ? aKeyInTheScale(fifths as number, scale) : { fifths: fifths as number, mode: minor === 1 ? 'minor' : 'major' };
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

/**
 * A sketch on this device as a sync sees it: the revision of it on the drive
 * this copy was last in step with - nought for one the drive has never had -
 * and whether it has been changed here since.
 */
export interface SketchHere {
  readonly sketch: StoredSketch;
  readonly revision: number;
  readonly unsent: boolean;
}

/**
 * A sketch in the form it is kept in, here and on the drive alike: its notes
 * and beats packed, its key as a pair.
 */
export function sketchAsKept(sketch: StoredSketch): Record<string, unknown> {
  return {
    id: sketch.id,
    title: sketch.title,
    begunAtMs: sketch.begunAtMs,
    events: sketch.events.map(pack),
    // Its notes say how loud they are written: see `readSketch`.
    loudness: 1,
    beats: sketch.beats.map(packBeat),
    key: [
      sketch.key.fifths,
      sketch.key.mode === 'minor' ? 1 : 0,
      ...(sketch.key.scale === undefined ? [] : [sketch.key.scale]),
    ],
  };
}

/** A sketch read back from the form it is kept in, or `null` where it does not hold together. */
export function sketchFromKept(value: unknown): StoredSketch | null {
  return readSketch(value);
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
  const written = value['loudness'] === 1 ? unpacked : unpacked.map(theLevelItWasStruckAt);
  return sketchOf(id, title, begunAtMs, written, theBeatsIfWhole(beats), readKey(key));
}

/**
 * A note kept before notes said how loud they are written, read as written
 * at a level where it is struck exactly as hard as one: a level's button
 * struck it so, and nothing else strikes so exactly. Any other was played,
 * and is as loud as it is.
 */
function theLevelItWasStruckAt(event: MidiFileEvent): MidiFileEvent {
  if (event.kind !== 'noteOn' || event.loudness !== undefined) {
    return event;
  }
  const level = DYNAMIC_LEVELS.find((each) => Math.round(DYNAMIC_VELOCITY[each] * 127) === Math.round(event.velocity * 127));
  return level === undefined ? event : { ...event, loudness: { level, shade: 0 } };
}

function sketchOf(
  id: string,
  title: string,
  begunAtMs: number,
  events: readonly MidiFileEvent[],
  beats: readonly HeardBeat[],
  key: SketchKey,
): StoredSketch {
  // Each note written at a level struck as hard as it says, wherever the
  // events came from: the one place its velocity is worked out.
  const written = takeWithTheLoudnessWritten(events);
  return {
    id,
    title,
    begunAtMs,
    events: written,
    beats,
    noteCount: written.filter((event) => event.kind === 'noteOn').length,
    key,
  };
}

/**
 * The sketches being written, across visits. Kept until the writer deletes one.
 *
 * And what a sync of them between devices needs kept beside them: for each,
 * the revision of it the drive had when this copy was last in step with it,
 * and whether it has been changed here since; and when anything was last
 * changed here, for a sync to be pressed half a minute after. No clock is
 * compared with another device's: a revision is a count the drive keeps.
 * Deleting a sketch here takes it off this device only, as with a score:
 * the drive keeps it, and offers it back.
 */
export class SketchLibrary {
  private readonly store: ISettingsStore;
  private readonly now: () => number;
  private sketches: StoredSketch[] = [];
  private readonly revisions = new Map<string, number>();
  private readonly unsent = new Set<string>();
  private changedAtMs = 0;
  private chords: (readonly number[])[] = [];
  /** The kept chords as the drive had them when last in step, or `null` before any sync: what a sync merges from. */
  private chordsInStep: (readonly number[])[] | null = null;
  private lastOpened: { readonly id: string; readonly atMs: number } | null = null;

  constructor(store: ISettingsStore, now: () => number) {
    this.store = store;
    this.now = now;
  }

  /** Reads what previous visits kept. A bad entry costs a sketch, not the app. */
  load(): void {
    const raw = this.store.read();
    const entries: unknown[] = isRecord(raw) && Array.isArray(raw['sketches']) ? raw['sketches'] : [];
    this.sketches = [];
    this.revisions.clear();
    this.unsent.clear();
    for (const entry of entries) {
      const sketch = readSketch(entry);
      if (sketch === null) {
        continue;
      }
      this.sketches.push(sketch);
      const { revision, unsent } = entry as { revision?: unknown; unsent?: unknown };
      const synced = typeof revision === 'number' && Number.isInteger(revision) && revision > 0 ? revision : 0;
      if (synced > 0) {
        this.revisions.set(sketch.id, synced);
      }
      // Kept before there was a drive to send it to, it has never been sent.
      if (unsent === 1 || synced === 0) {
        this.unsent.add(sketch.id);
      }
    }
    const changed = isRecord(raw) ? raw['changedAtMs'] : undefined;
    this.changedAtMs = typeof changed === 'number' && Number.isFinite(changed) ? changed : 0;
    const opened = isRecord(raw) ? raw['opened'] : undefined;
    const [openedId, openedAtMs] = Array.isArray(opened) ? (opened as unknown[]) : [];
    this.lastOpened =
      typeof openedId === 'string' && typeof openedAtMs === 'number' && Number.isFinite(openedAtMs)
        ? { id: openedId, atMs: openedAtMs }
        : null;
    this.chords = readTheChords(isRecord(raw) ? raw['chords'] : undefined) ?? [];
    this.chordsInStep = readTheChords(isRecord(raw) ? raw['chordsInStep'] : undefined);
  }

  /**
   * Marks a sketch the one opened last, now - in the editor, or written down
   * as a score - so that the page can open on it again. Kept on this device
   * only: which was opened last is this device's question.
   */
  opened(id: string): void {
    if (this.find(id) === null) {
      return;
    }
    this.lastOpened = { id, atMs: this.now() };
    this.persist();
  }

  /** The sketch opened last, and when, or `null` where none has been or it is gone. */
  get openedLast(): { readonly sketch: StoredSketch; readonly atMs: number } | null {
    const sketch = this.lastOpened === null ? null : this.find(this.lastOpened.id);
    return sketch === null || this.lastOpened === null ? null : { sketch, atMs: this.lastOpened.atMs };
  }

  /**
   * The chords the writer has kept in the palette, to write into any sketch:
   * each its keys, once, low to high, in the order they were kept. Kept with
   * the sketches, as the writer's own, and not with any one of them.
   */
  keptChords(): readonly (readonly number[])[] {
    return this.chords;
  }

  /** Keeps a chord in the palette, after the others - unless it is there already, or is one key. */
  keepTheChord(midis: readonly number[]): void {
    const once = eachKeyOnce(midis);
    if (once.length < 2 || this.chords.some((chord) => sameKeys(chord, once))) {
      return;
    }
    this.chords = [...this.chords, once];
    this.changedAtMs = this.now();
    this.persist();
  }

  /** Takes a chord out of the palette. */
  letGoOfTheChord(midis: readonly number[]): void {
    const left = this.chords.filter((chord) => !sameKeys(chord, midis));
    if (left.length === this.chords.length) {
      return;
    }
    this.chords = left;
    this.changedAtMs = this.now();
    this.persist();
  }

  /** The kept chords as a sync sees them: as they are here, and as the drive had them when last in step. */
  chordsForTheDrive(): { readonly kept: readonly (readonly number[])[]; readonly inStep: readonly (readonly number[])[] | null } {
    return { kept: this.chords, inStep: this.chordsInStep };
  }

  /**
   * The kept chords as a sync settled them, the drive having them now - and
   * whatever was kept or let go of here while it was away at the drive, since
   * the list it settled from (`from`), done to them, to go at the next.
   */
  chordsSettled(chords: readonly (readonly number[])[], from: readonly (readonly number[])[]): void {
    this.chords = [...theChordsMerged(chords, this.chords, from)];
    this.chordsInStep = [...chords];
    this.persist();
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
    this.changedHere(sketch.id);
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
    this.changedHere(id);
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
    this.changedHere(id);
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
    this.changedHere(id);
    return changed;
  }

  /** Takes a sketch off this device: only this one - the drive keeps what it has had. */
  remove(id: string): void {
    const before = this.sketches.length;
    this.sketches = this.sketches.filter((sketch) => sketch.id !== id);
    if (this.sketches.length === before) {
      return;
    }
    this.revisions.delete(id);
    this.unsent.delete(id);
    this.persist();
  }

  /** Every sketch here, as a sync sees it. */
  forTheDrive(): readonly SketchHere[] {
    return this.sketches.map((sketch) => ({
      sketch,
      revision: this.revisions.get(sketch.id) ?? 0,
      unsent: this.unsent.has(sketch.id),
    }));
  }

  /**
   * When something changed here that the drive has not had, or `null` while
   * it has had everything: for a sync to be pressed half a minute after.
   */
  get unsentSinceMs(): number | null {
    return this.unsent.size > 0 || this.chordsUnsent() ? this.changedAtMs : null;
  }

  /** Whether the kept chords are other than the drive had them when last in step: some kept or let go of since. */
  private chordsUnsent(): boolean {
    const inStep = this.chordsInStep ?? [];
    return (
      this.chords.length !== inStep.length || this.chords.some((chord) => !inStep.some((other) => sameKeys(chord, other)))
    );
  }

  /** A sketch sent to the drive at a revision: in step with it, and nothing unsent. */
  sentAt(id: string, revision: number): void {
    this.revisions.set(id, revision);
    this.unsent.delete(id);
    this.persist();
  }

  /** A sketch as the drive has it, at its revision, over or beside what is here. */
  takeFromTheDrive(sketch: StoredSketch, revision: number): void {
    const there = sketchOf(sketch.id, sketch.title, sketch.begunAtMs, sketch.events, sketch.beats, sketch.key);
    const here = this.find(sketch.id) !== null;
    this.sketches = here
      ? this.sketches.map((each) => (each.id === sketch.id ? there : each))
      : [...this.sketches, there];
    this.revisions.set(sketch.id, revision);
    this.unsent.delete(sketch.id);
    this.persist();
  }

  /**
   * Keeps a sketch as it is here under a new id and name, never yet sent: what
   * a change made here becomes where the drive has another, so that taking
   * the drive's loses neither.
   */
  keepACopy(id: string, title: string): StoredSketch | null {
    const found = this.find(id);
    if (found === null) {
      return null;
    }
    const copy = { ...found, id: this.unusedId(`${id}-copy`), title };
    this.sketches = [...this.sketches, copy];
    this.unsent.add(copy.id);
    this.persist();
    return copy;
  }

  /** A sketch changed here: unsent, and when, kept. */
  private changedHere(id: string): void {
    this.unsent.add(id);
    this.changedAtMs = this.now();
    this.persist();
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
        ...sketchAsKept(sketch),
        ...(this.revisions.has(sketch.id) ? { revision: this.revisions.get(sketch.id) } : {}),
        ...(this.unsent.has(sketch.id) ? { unsent: 1 } : {}),
      })),
      changedAtMs: this.changedAtMs,
      ...(this.chords.length > 0 ? { chords: this.chords } : {}),
      ...(this.chordsInStep === null ? {} : { chordsInStep: this.chordsInStep }),
      ...(this.lastOpened === null ? {} : { opened: [this.lastOpened.id, this.lastOpened.atMs] }),
    });
  }
}
