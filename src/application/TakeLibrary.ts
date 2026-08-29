import type { MidiFileEvent } from '../domain/midi/MidiFile.js';
import type { ISettingsStore } from './ports/ISettingsStore.js';
import type { Take } from './PerformanceRecorder.js';

export const TAKES_STORAGE_KEY = 'sight-reading-practice.takes.v1';

/**
 * Which shelf a take is on.
 *
 * `recent` is everything that was played, filed without being asked for and
 * thrown away oldest-first once the shelf is full. `kept` is what the reader
 * said to keep, and nothing takes those away.
 *
 * The two exist because the decision and the playing happen at different
 * times. An idea is noticed after it has been played, and the reader who
 * plays the next thing before reaching for a button used to lose the first
 * one with no sign that anything had gone.
 */
export const TAKE_SHELVES = ['recent', 'kept'] as const;

export type TakeShelf = (typeof TAKE_SHELVES)[number];

export interface StoredTake {
  readonly id: string;
  /** Wall-clock moment the take was kept, for naming and ordering. */
  readonly savedAtMs: number;
  readonly durationMs: number;
  readonly noteCount: number;
  readonly shelf: TakeShelf;
  readonly events: readonly MidiFileEvent[];
}

const STORAGE_VERSION = 1;
/** Takes on the recent shelf before the oldest is dropped. */
const KEEP_TAKES = 100;
/**
 * Events kept across the whole library.
 *
 * Browser storage is a few megabytes and already holds the settings and the
 * practice history; a morning of playing would fill it on its own. The oldest
 * takes go first, which is the order a reader would have chosen anyway.
 */
const KEEP_EVENTS = 40_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * One event as a tuple, which is most of what makes the library fit.
 *
 * `{"kind":"noteOn","atMs":12345,"midi":60,"velocity":0.7}` is fifty-odd
 * characters and `[0,12345,60,89]` is fifteen, over tens of thousands of
 * events. The events themselves stay the stored thing - the MIDI file is
 * derived from them on export, never the other way round, for the same
 * reason an `Exercise` and not its MusicXML is what this project keeps.
 */
type Packed = readonly [kind: number, atMs: number, a: number, b: number];

function pack(event: MidiFileEvent): Packed {
  switch (event.kind) {
    case 'noteOn':
      return [0, Math.round(event.atMs), event.midi, Math.round(event.velocity * 127)];
    case 'noteOff':
      return [1, Math.round(event.atMs), event.midi, 0];
    case 'sustain':
      return [2, Math.round(event.atMs), 0, Math.round(event.value * 127)];
  }
}

function unpack(value: unknown): MidiFileEvent | null {
  if (!Array.isArray(value) || value.length < 4) {
    return null;
  }
  const [kind, atMs, a, b] = value as readonly unknown[];
  if (typeof kind !== 'number' || typeof atMs !== 'number' || typeof a !== 'number' || typeof b !== 'number') {
    return null;
  }
  switch (kind) {
    case 0:
      return { kind: 'noteOn', atMs, midi: a, velocity: b / 127 };
    case 1:
      return { kind: 'noteOff', atMs, midi: a };
    case 2:
      return { kind: 'sustain', atMs, value: b / 127 };
    default:
      return null;
  }
}

function readTake(value: unknown): StoredTake | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, savedAtMs, durationMs, noteCount, events, shelf } = value;
  if (typeof id !== 'string' || typeof savedAtMs !== 'number' || typeof durationMs !== 'number') {
    return null;
  }
  if (!Array.isArray(events)) {
    return null;
  }
  const unpacked = events.map(unpack).filter((event): event is MidiFileEvent => event !== null);
  if (unpacked.length === 0) {
    return null;
  }
  return {
    id,
    savedAtMs,
    durationMs,
    noteCount: typeof noteCount === 'number' ? noteCount : 0,
    // Anything written before there were two shelves was kept on purpose,
    // since keeping was the only way a take got here at all.
    shelf: shelf === 'recent' ? 'recent' : 'kept',
    events: unpacked,
  };
}

/**
 * The takes the reader has kept, across visits.
 *
 * A list rather than a straight-to-file export, because an idea is worth
 * keeping before it is worth naming: the reader plays, presses keep, and goes
 * on playing. Deciding which ones matter is a separate act, done later and at
 * the desk.
 */
export class TakeLibrary {
  private readonly store: ISettingsStore;
  private readonly keep: number;
  private takes: StoredTake[] = [];

  constructor(store: ISettingsStore, keep = KEEP_TAKES) {
    this.store = store;
    this.keep = keep;
  }

  /** Reads what previous visits kept. Bad entries cost a take, not the app. */
  load(): void {
    const raw = this.store.read();
    if (!isRecord(raw) || !Array.isArray(raw['takes'])) {
      this.takes = [];
      return;
    }
    this.takes = raw['takes']
      .map(readTake)
      .filter((take): take is StoredTake => take !== null);
  }

  /** Newest first: the take a reader wants is almost always the last one. */
  list(): readonly StoredTake[] {
    return [...this.takes].sort((left, right) => right.savedAtMs - left.savedAtMs);
  }

  get isEmpty(): boolean {
    return this.takes.length === 0;
  }

  find(id: string): StoredTake | null {
    return this.takes.find((take) => take.id === id) ?? null;
  }

  /** Files a take on the shelf the reader asked for. */
  file(
    take: Take,
    savedAtMs: number,
    shelf: TakeShelf,
    id = `take-${savedAtMs.toString(36)}`,
  ): StoredTake {
    const stored: StoredTake = {
      id: this.unusedId(id),
      savedAtMs,
      durationMs: take.durationMs,
      noteCount: take.noteCount,
      shelf,
      events: take.events,
    };
    this.takes = [...this.takes, stored];
    this.prune();
    this.persist();
    return stored;
  }

  /** What the reader's button does: this one is not to be thrown away. */
  keepTake(take: Take, savedAtMs: number, id = `take-${savedAtMs.toString(36)}`): StoredTake {
    return this.file(take, savedAtMs, 'kept', id);
  }

  /**
   * The wanted id, or the nearest one nobody is using.
   *
   * Ids are minted from the clock, and the clock is coarser than the reader.
   * Two takes kept in the same millisecond - a keep followed at once by the
   * one that closed behind it - are still two takes, and the second used to
   * land on the first's id and quietly replace it.
   */
  private unusedId(wanted: string): string {
    if (!this.takes.some((take) => take.id === wanted)) {
      return wanted;
    }
    for (let suffix = 2; suffix < 1_000; suffix += 1) {
      const candidate = `${wanted}-${suffix}`;
      if (!this.takes.some((take) => take.id === candidate)) {
        return candidate;
      }
    }
    return `${wanted}-${this.takes.length}`;
  }

  /** Moves a take off the shelf that prunes, onto the one that does not. */
  promote(id: string): StoredTake | null {
    const found = this.takes.find((take) => take.id === id);
    if (found === undefined || found.shelf === 'kept') {
      return found ?? null;
    }
    const promoted: StoredTake = { ...found, shelf: 'kept' };
    this.takes = this.takes.map((take) => (take.id === id ? promoted : take));
    this.persist();
    return promoted;
  }

  remove(id: string): void {
    const before = this.takes.length;
    this.takes = this.takes.filter((take) => take.id !== id);
    if (this.takes.length !== before) {
      this.persist();
    }
  }

  forget(): void {
    this.takes = [];
    this.store.clear();
  }

  /**
   * Oldest out first, by count and by the events they hold between them.
   *
   * Only ever off the recent shelf. A take the reader asked to keep is the one
   * thing here that was chosen, and a library that quietly threw those away
   * would be worse than no library - the reader would find out by looking for
   * something that is gone.
   */
  private prune(): void {
    const kept = this.takes.filter((take) => take.shelf === 'kept');
    const recent = this.takes
      .filter((take) => take.shelf === 'recent')
      .sort((left, right) => left.savedAtMs - right.savedAtMs);

    while (recent.length > this.keep) {
      recent.shift();
    }
    let total = [...kept, ...recent].reduce((sum, take) => sum + take.events.length, 0);
    while (total > KEEP_EVENTS && recent.length > 0) {
      total -= recent.shift()?.events.length ?? 0;
    }
    this.takes = [...kept, ...recent];
  }

  private persist(): void {
    this.store.write({
      version: STORAGE_VERSION,
      takes: this.takes.map((take) => ({
        id: take.id,
        savedAtMs: take.savedAtMs,
        durationMs: take.durationMs,
        noteCount: take.noteCount,
        shelf: take.shelf,
        events: take.events.map(pack),
      })),
    });
  }
}
