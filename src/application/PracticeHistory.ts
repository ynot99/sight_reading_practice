import type { Grade } from '../domain/scoring/IScoringStrategy.js';
import type { NoteCounts } from '../domain/scoring/PerformanceReport.js';
import type { ReadingPicture } from '../domain/scoring/ReadingPicture.js';
import type { ISettingsStore } from './ports/ISettingsStore.js';
import type { RunRoll } from './session/RunRoll.js';

export interface PracticeAttempt {
  readonly atMs: number;
  /**
   * What the reading was played at, and with which hand.
   *
   * Kept because a score means nothing without them: eighty-two per cent of
   * a passage at seventy with one hand is a different afternoon's work from
   * eighty-two at full speed with both. Optional, since everything recorded
   * before this existed has no answer and inventing one would be worse.
   */
  readonly tempoPercent?: number;
  readonly hand?: number | null;
  /** The strategy's verdict, `0..1`. */
  readonly overall: number;
  readonly grade: Grade;
  /** False when the reader stopped rather than reaching the end. */
  readonly completed: boolean;
  /**
   * What became of its notes: Perfect, Good, missed, and the wrong ones.
   *
   * Kept on the reading and not in its picture, which is given up first
   * when the store fills: four numbers, and the way to see at a glance
   * whether anything was played at all. Absent from readings kept before
   * notes were counted so.
   */
  readonly notes?: NoteCounts;
  /**
   * The bar they stopped in, one-based, where they stopped.
   *
   * Kept beside the picture rather than inside it: two characters, and a
   * reading old enough to have lost its picture can still say where it ended.
   */
  readonly stoppedAtBar?: number | null;
  /** What was switched on for it, as the badges over the score name them. */
  readonly modes?: readonly string[];
  /** The kind of run it was: the frame's own id, as the settings carry it. */
  readonly modeId?: string;
  /** Enough to draw the reading again; dropped from the oldest when the store fills. */
  readonly picture?: ReadingPicture;
  /** What was played, for the roll viewer. The heaviest thing here, and the first dropped. */
  readonly roll?: RunRoll;
}

export interface PassageHistory {
  readonly attempts: number;
  readonly best: number;
  readonly last: number;
  /** The attempt before the last one, or `null` on a first visit. */
  readonly previous: number | null;
}

const STORAGE_VERSION = 1;
const KEEP_PER_PASSAGE = 50;
const KEEP_PASSAGES = 200;

/**
 * How much of the browser's store this may take.
 *
 * The store holds about five megabytes for the whole application, and the
 * takes already have a budget of their own. When a write goes over what is
 * left, the browser refuses it and the store swallows the refusal - so a
 * history that grew until it was refused would stop being written with
 * nothing said. It keeps itself under a budget instead, and what it gives up
 * first is the oldest readings' detail rather than the readings.
 */
const MOST_CHARACTERS = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The piece a key belongs to, without the bars of it that were read. */
export function pieceOfKey(key: string): string {
  return key.split(' bars:')[0] ?? key;
}

function readNumbers(value: unknown): readonly number[] {
  return Array.isArray(value) ? value.filter((each): each is number => typeof each === 'number') : [];
}

function readStrings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : [];
}

/**
 * A kept picture, or nothing where it is not one.
 *
 * Checked at the edges only: the bars, the marks and the numbers the drawing
 * reads. What is inside the axes and the totals was written by this program
 * and is drawn as text, so a changed field costs a wrong label rather than a
 * broken page.
 */
function readPicture(value: unknown): ReadingPicture | null {
  if (!isRecord(value) || typeof value['bars'] !== 'string' || !isRecord(value['totals'])) {
    return null;
  }
  return {
    bars: value['bars'],
    waitedAtBars: readNumbers(value['waitedAtBars']),
    axes: Array.isArray(value['axes']) ? (value['axes'] as ReadingPicture['axes']) : [],
    deviationsMs: readNumbers(value['deviationsMs']),
    pressesJudged:
      typeof value['pressesJudged'] === 'number'
        ? value['pressesJudged']
        : readNumbers(value['deviationsMs']).length,
    toleranceMs: typeof value['toleranceMs'] === 'number' ? value['toleranceMs'] : 0,
    ...(typeof value['tiersOfMarks'] === 'string' ? { tiersOfMarks: value['tiersOfMarks'] } : {}),
    ...(typeof value['perfectMs'] === 'number' ? { perfectMs: value['perfectMs'] } : {}),
    totals: value['totals'] as unknown as ReadingPicture['totals'],
    meanDeviationMs: typeof value['meanDeviationMs'] === 'number' ? value['meanDeviationMs'] : 0,
    meanAbsoluteDeviationMs:
      typeof value['meanAbsoluteDeviationMs'] === 'number' ? value['meanAbsoluteDeviationMs'] : 0,
    deviationSpreadMs:
      typeof value['deviationSpreadMs'] === 'number' ? value['deviationSpreadMs'] : 0,
    stoppedAtBar: typeof value['stoppedAtBar'] === 'number' ? value['stoppedAtBar'] : null,
  };
}

/** Kept counts of notes, or nothing where any of the four is not a count. */
function readNotes(value: unknown): NoteCounts | null {
  if (!isRecord(value)) {
    return null;
  }
  const [perfect, good, missed, wrong] = ['perfect', 'good', 'missed', 'wrong'].map((name) => value[name]);
  const counts = [perfect, good, missed, wrong];
  if (!counts.every((count) => typeof count === 'number' && Number.isInteger(count) && count >= 0)) {
    return null;
  }
  return { perfect, good, missed, wrong } as NoteCounts;
}

/**
 * Whether one stopped reading got further than another: above nought if it did.
 *
 * By the notes it played - Perfect and Good together - which is how far it
 * got and how well in one number: fifteen bars played cleanly are more
 * notes than three played cleanly, and more than fifteen played badly.
 * Readings kept before notes were counted have no such number, and between
 * two where either lacks it the bar each stopped in answers instead. The
 * grade breaks a tie.
 */
function furtherThan(one: PracticeAttempt, other: PracticeAttempt): number {
  const played =
    one.notes !== undefined && other.notes !== undefined
      ? one.notes.perfect + one.notes.good - (other.notes.perfect + other.notes.good)
      : (one.stoppedAtBar ?? 0) - (other.stoppedAtBar ?? 0);
  return played !== 0 ? played : one.overall - other.overall;
}

/**
 * The readings of a passage it keeps whatever else it gives up: the best of
 * those played to the end, by the grade, and the best of those stopped.
 *
 * Two and not one, because neither can stand for the other. A reading
 * played to the end ranks above one that stopped, but fifteen bars of
 * twenty played cleanly are not undone by a whole run played badly the day
 * after - and keeping only the finished one would throw them away. The
 * newer of two as good as each other.
 */
function theBestOf(attempts: readonly PracticeAttempt[]): PracticeAttempt[] {
  let finished: PracticeAttempt | null = null;
  let stopped: PracticeAttempt | null = null;
  for (const attempt of attempts) {
    if (attempt.completed) {
      finished = finished === null || attempt.overall >= finished.overall ? attempt : finished;
    } else {
      stopped = stopped === null || furtherThan(attempt, stopped) >= 0 ? attempt : stopped;
    }
  }
  return [finished, stopped].filter((best): best is PracticeAttempt => best !== null);
}

/** The newest `keep` of a passage's readings, and its best however old: see `theBestOf`. */
function whatAPassageKeeps(attempts: readonly PracticeAttempt[], keep: number): PracticeAttempt[] {
  const kept = new Set([...attempts.slice(-keep), ...theBestOf(attempts)]);
  return attempts.filter((each) => kept.has(each));
}

/** A kept roll, or nothing where the lists it is made of are not there. */
function readRoll(value: unknown): RunRoll | null {
  if (!isRecord(value)) {
    return null;
  }
  const lists = ['presses', 'beats', 'pedal', 'rushes'];
  if (!lists.every((name) => Array.isArray(value[name]))) {
    return null;
  }
  return value as unknown as RunRoll;
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
  const tempoPercent = value['tempoPercent'];
  const hand = value['hand'];
  const stoppedAtBar = value['stoppedAtBar'];
  const modeId = value['modeId'];
  const modes = readStrings(value['modes']);
  const picture = readPicture(value['picture']);
  const roll = readRoll(value['roll']);
  const notes = readNotes(value['notes']);
  return {
    atMs,
    overall,
    grade: grade as Grade,
    completed: value['completed'] === true,
    ...(typeof tempoPercent === 'number' ? { tempoPercent } : {}),
    ...(typeof hand === 'number' || hand === null ? { hand: hand as number | null } : {}),
    ...(typeof stoppedAtBar === 'number' ? { stoppedAtBar } : {}),
    ...(notes !== null ? { notes } : {}),
    ...(typeof modeId === 'string' ? { modeId } : {}),
    ...(modes.length > 0 ? { modes } : {}),
    ...(picture !== null ? { picture } : {}),
    ...(roll !== null ? { roll } : {}),
  };
}

/** One reading, and the passage it was a reading of. */
export interface PracticeReading extends PracticeAttempt {
  /** The key it was filed under, which says the piece and the bars. */
  readonly key: string;
}

/**
 * What has been practised before, and whether it is getting better.
 *
 * Without this every run is the reader's first: the drill picks a passage from
 * the last reading alone and cannot say "you have been here three times and it
 * is steadier now". A practice tool that forgets is a metronome with opinions.
 *
 * A handful of numbers per reading answers "again?" and "better?", which is
 * what a reader actually asks. Beyond them each reading carries a picture of
 * itself - how the bars read, the shape of the playing, the scatter about the
 * beat - and, while there is room, what was played. Those are what a reader
 * asks of one particular afternoon, and they are kept under a budget: the
 * oldest readings give up their roll, then their picture, and only then
 * themselves. The alternative was keeping every run's full report, which for
 * a long piece is a megabyte a reading and ends in a store too full to write
 * to, without a word said.
 */
export class PracticeHistory {
  private readonly store: ISettingsStore;
  private readonly keep: number;
  private readonly mostCharacters: number;
  private passages = new Map<string, PracticeAttempt[]>();

  constructor(store: ISettingsStore, keep = KEEP_PER_PASSAGE, mostCharacters = MOST_CHARACTERS) {
    this.store = store;
    this.keep = keep;
    this.mostCharacters = mostCharacters;
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
        this.passages.set(key, whatAPassageKeeps(attempts, this.keep));
      }
    }
  }

  record(key: string, attempt: PracticeAttempt): void {
    const all = [...(this.passages.get(key) ?? []), attempt];
    // Re-inserting moves the passage to the end, so the oldest *untouched*
    // one gives up its readings rather than the oldest ever recorded.
    this.passages.delete(key);
    this.passages.set(key, whatAPassageKeeps(all, this.keep));
    this.letTheOldestPassagesGo();
    this.flush();
  }

  /**
   * Beyond the passages practised most recently, the rest give up every
   * reading but their best.
   *
   * Given up, not forgotten: a passage played at all has a best, and it
   * stays where it was among those practised longest ago. What bounds how
   * many there are is the budget, which reaches a passage's best last.
   */
  private letTheOldestPassagesGo(): void {
    const keys = [...this.passages.keys()];
    for (const key of keys.slice(0, Math.max(0, keys.length - KEEP_PASSAGES))) {
      this.passages.set(key, theBestOf(this.passages.get(key) ?? []));
    }
  }

  /**
   * Every reading there is, newest first.
   *
   * Flattened out of the per-passage lists rather than kept a second time: a
   * table of the last twenty readings and a table of the best ten are two
   * views of the same thing, and a second copy would be a second thing to
   * keep in step with the first.
   */
  everyReading(): readonly PracticeReading[] {
    const all: PracticeReading[] = [];
    for (const [key, attempts] of this.passages) {
      for (const attempt of attempts) {
        all.push({ ...attempt, key });
      }
    }
    return all.sort((left, right) => right.atMs - left.atMs);
  }

  /** The readings most recently played, of one piece where one is named. */
  lastReadings(limit = 20, ofPiece?: string): readonly PracticeReading[] {
    return this.readingsOf(ofPiece).slice(0, Math.max(0, limit));
  }

  /**
   * The best readings, those that reached the end above every one that did not.
   *
   * A run stopped after four notes of a hard passage can score anything at
   * all, and a table of bests that it could win would be a table of who
   * stopped soonest. Left out altogether, though, a piece never yet played to
   * the end was not in the table at all, and with only that piece asked for
   * the table was empty - his, of the list with "this piece" ticked. So a
   * stopped reading is there, and only below all the finished ones.
   *
   * One a piece when no piece is named, or an afternoon spent on one of them
   * fills the table with itself and the rest of the library is not there to
   * compare. Exercises are the exception: `level:1a` is not a piece but a
   * ladder step, and every reading of it was a different melody.
   *
   * The hardest pieces first, and the best score among pieces as hard. His:
   * "Та сортувати по складності. Якщо є таке в нас." How hard a piece is
   * belongs to the piece and not to the reading - the stars are the reader's
   * own and change - so it is asked for rather than kept, and a piece rated
   * again since is ranked by what it is now. One nobody has rated says nothing
   * either way, and follows the ones that are rated, by score.
   */
  bestReadings(
    limit = 10,
    ofPiece?: string,
    howHard: (key: string) => number | null = () => null,
  ): readonly PracticeReading[] {
    const readings = this.readingsOf(ofPiece);
    const hardness = new Map(readings.map((reading) => [reading, howHard(reading.key)]));
    type Order = (left: PracticeReading, right: PracticeReading) => number;
    const finishedFirst: Order = (left, right) => Number(right.completed) - Number(left.completed);
    const hardestFirst: Order = (left, right) => {
      const leftIs = hardness.get(left) ?? null;
      const rightIs = hardness.get(right) ?? null;
      if (leftIs === rightIs) {
        return 0;
      }
      if (leftIs === null || rightIs === null) {
        return leftIs === null ? 1 : -1;
      }
      return rightIs - leftIs;
    };
    const bestScoreFirst: Order = (left, right) =>
      right.overall - left.overall || right.atMs - left.atMs;
    const byStanding: Order = (left, right) =>
      finishedFirst(left, right) || bestScoreFirst(left, right);
    const byRank: Order = (left, right) =>
      finishedFirst(left, right) || hardestFirst(left, right) || bestScoreFirst(left, right);
    // One piece is as hard as itself, so its own readings go by score alone.
    if (ofPiece !== undefined) {
      return [...readings].sort(byStanding).slice(0, Math.max(0, limit));
    }
    const best = new Map<string, PracticeReading>();
    const exercises: PracticeReading[] = [];
    for (const reading of readings) {
      if (reading.key.startsWith('level:')) {
        exercises.push(reading);
        continue;
      }
      const piece = pieceOfKey(reading.key);
      const standing = best.get(piece);
      if (standing === undefined || byStanding(reading, standing) < 0) {
        best.set(piece, reading);
      }
    }
    return [...best.values(), ...exercises].sort(byRank).slice(0, Math.max(0, limit));
  }

  /**
   * Takes one reading out, for good.
   *
   * By where and when rather than by a name of its own: no two readings of a
   * passage end in the same millisecond, so the pair is already a name, and
   * inventing one would be a thing to keep in step with the store.
   */
  remove(key: string, atMs: number): boolean {
    const attempts = this.passages.get(key);
    if (attempts === undefined || !attempts.some((attempt) => attempt.atMs === atMs)) {
      return false;
    }
    const left = attempts.filter((attempt) => attempt.atMs !== atMs);
    if (left.length === 0) {
      this.passages.delete(key);
    } else {
      this.passages.set(key, left);
    }
    this.flush();
    return true;
  }

  private readingsOf(piece: string | undefined): readonly PracticeReading[] {
    const all = this.everyReading();
    return piece === undefined ? all : all.filter((reading) => pieceOfKey(reading.key) === piece);
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
    this.keepWithinTheBudget();
    this.store.write({
      version: STORAGE_VERSION,
      passages: Object.fromEntries(this.passages),
    });
  }

  /**
   * Gives up what there is no room for, newest readings keeping the most.
   *
   * Walked newest first, each reading is offered the room that is left: whole
   * if it fits, without its roll if that is what it takes, then without its
   * picture, and dropped only when even its numbers do not fit. So the
   * readings a reader is likely to open keep everything, an afternoon's
   * worth back they are still a picture, and a year back they are still a
   * score and a date - which is what the tables of last and best are made of.
   *
   * A passage's best readings are the exception, being kept whatever else
   * goes: room for their numbers is set aside before anything else is
   * offered any, so the most they give up is their roll and their picture -
   * short of a store too small for the bests alone, which at a few hundred
   * characters a passage is thousands of passages away.
   */
  private keepWithinTheBudget(): void {
    const sizeOf = (attempt: PracticeAttempt): number => JSON.stringify(attempt).length;
    const withoutTheRoll = ({ roll: _roll, ...rest }: PracticeAttempt): PracticeAttempt => rest;
    const withoutThePicture = ({ picture: _picture, ...rest }: PracticeAttempt): PracticeAttempt =>
      rest;
    const bare = (attempt: PracticeAttempt): PracticeAttempt => withoutThePicture(withoutTheRoll(attempt));

    const best = new Set([...this.passages.values()].flatMap(theBestOf));
    const newestFirst = [...this.passages.values()]
      .flat()
      .sort((left, right) => right.atMs - left.atMs);
    const kept = new Map<PracticeAttempt, PracticeAttempt | null>();
    let used = [...best].reduce((sum, attempt) => sum + sizeOf(bare(attempt)), 0);
    for (const attempt of newestFirst) {
      // A best reading's numbers are already paid for.
      const paid = best.has(attempt) ? sizeOf(bare(attempt)) : 0;
      let keeping: PracticeAttempt | null = attempt;
      if (used - paid + sizeOf(keeping) > this.mostCharacters) {
        keeping = withoutTheRoll(keeping);
      }
      if (used - paid + sizeOf(keeping) > this.mostCharacters) {
        keeping = withoutThePicture(keeping);
      }
      if (used - paid + sizeOf(keeping) > this.mostCharacters) {
        keeping = null;
      }
      kept.set(attempt, keeping);
      used += (keeping === null ? 0 : sizeOf(keeping)) - paid;
    }
    for (const [key, attempts] of [...this.passages]) {
      const left = attempts
        .map((attempt) => kept.get(attempt) ?? null)
        .filter((attempt): attempt is PracticeAttempt => attempt !== null);
      if (left.length === 0) {
        this.passages.delete(key);
      } else {
        this.passages.set(key, left);
      }
    }
  }
}
