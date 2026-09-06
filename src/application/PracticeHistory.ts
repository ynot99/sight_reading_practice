import type { Grade } from '../domain/scoring/IScoringStrategy.js';
import type { ISettingsStore } from './ports/ISettingsStore.js';

export interface PracticeAttempt {
  readonly atMs: number;
  /** The strategy's verdict, `0..1`. */
  readonly overall: number;
  readonly grade: Grade;
  /** False when the reader stopped rather than reaching the end. */
  readonly completed: boolean;
}

export interface PassageHistory {
  readonly attempts: number;
  readonly best: number;
  readonly last: number;
  /** The attempt before the last one, or `null` on a first visit. */
  readonly previous: number | null;
}

const STORAGE_VERSION = 1;
const KEEP_PER_PASSAGE = 20;
const KEEP_PASSAGES = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readAttempt(value: unknown): PracticeAttempt | null {
  if (!isRecord(value)) {
    return null;
  }
  const overall = value['overall'];
  const atMs = value['atMs'];
  const grade = value['grade'];
  if (typeof overall !== 'number' || typeof atMs !== 'number' || typeof grade !== 'string') {
    return null;
  }
  return {
    atMs,
    overall,
    grade: grade as Grade,
    completed: value['completed'] === true,
  };
}

/**
 * What has been practised before, and whether it is getting better.
 *
 * Without this every run is the reader's first: the drill picks a passage from
 * the last reading alone and cannot say "you have been here three times and it
 * is steadier now". A practice tool that forgets is a metronome with opinions.
 *
 * Deliberately small. A handful of numbers per passage answers "again?" and
 * "better?", which is what a reader actually asks; a full history of every
 * note belongs in a different kind of application.
 */
export class PracticeHistory {
  private readonly store: ISettingsStore;
  private readonly keep: number;
  private passages = new Map<string, PracticeAttempt[]>();

  constructor(store: ISettingsStore, keep = KEEP_PER_PASSAGE) {
    this.store = store;
    this.keep = keep;
  }

  /** Reads what is stored, ignoring anything that no longer parses. */
  load(): void {
    const raw = this.store.read();
    const passages = isRecord(raw) ? raw['passages'] : null;
    this.passages = new Map();
    if (!isRecord(passages)) {
      return;
    }
    for (const [key, value] of Object.entries(passages)) {
      if (!Array.isArray(value)) {
        continue;
      }
      const attempts = value
        .map(readAttempt)
        .filter((attempt): attempt is PracticeAttempt => attempt !== null);
      if (attempts.length > 0) {
        this.passages.set(key, attempts.slice(-this.keep));
      }
    }
  }

  record(key: string, attempt: PracticeAttempt): void {
    const attempts = [...(this.passages.get(key) ?? []), attempt].slice(-this.keep);
    // Re-inserting moves the passage to the end, so the oldest *untouched*
    // one is dropped rather than the oldest ever recorded.
    this.passages.delete(key);
    this.passages.set(key, attempts);
    while (this.passages.size > KEEP_PASSAGES) {
      const oldest = this.passages.keys().next();
      if (oldest.done) {
        break;
      }
      this.passages.delete(oldest.value);
    }
    this.flush();
  }

  summary(key: string): PassageHistory | null {
    const attempts = this.passages.get(key);
    const last = attempts?.at(-1);
    if (attempts === undefined || last === undefined) {
      return null;
    }
    return {
      attempts: attempts.length,
      best: Math.max(...attempts.map((attempt) => attempt.overall)),
      last: last.overall,
      previous: attempts.at(-2)?.overall ?? null,
    };
  }

  /**
   * Files everything under whatever name the given function gives it.
   *
   * For renaming a piece: a reader who renames one has not started it again,
   * and the badge on the transport - "Reading 3 · best 82%" - is one of the
   * few things in here that answers "am I getting better". Losing it silently
   * would make renaming feel like a thing to be careful with, which for a
   * name is absurd.
   *
   * A function rather than a pair of prefixes, because deciding which keys
   * belong to a piece needs to know how a key is built, and that is decided
   * where they are built. Titles have spaces in them, so "Old" is a prefix of
   * "Old Man" on any reading a store could invent for itself.
   */
  rekey(name: (key: string) => string): void {
    const moved = new Map<string, PracticeAttempt[]>();
    for (const [key, attempts] of this.passages) {
      // The order is the order they were last practised in, and the map is
      // trimmed from its oldest end, so it has to be rebuilt rather than
      // written into as it is walked.
      moved.set(name(key), attempts);
    }
    this.passages = moved;
    this.flush();
  }

  forget(): void {
    this.passages = new Map();
    this.store.clear();
  }

  private flush(): void {
    this.store.write({
      version: STORAGE_VERSION,
      passages: Object.fromEntries(this.passages),
    });
  }
}
