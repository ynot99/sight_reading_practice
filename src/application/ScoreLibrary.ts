import { measureCount } from '../domain/model/Exercise.js';
import type { Exercise } from '../domain/model/Exercise.js';
import type { IMusicXmlSerializer } from '../domain/notation/MusicXmlSerializer.js';
import type { ClickPattern } from './ports/IMetronome.js';
import type { IScoreImporter } from './ports/IScoreImporter.js';
import type { IScoreStore, SavedPassage, StoredScoreSummary } from './ports/IScoreStore.js';
import type { IKeepsTheStore } from './ports/IStorageGauge.js';

/**
 * What the reader wants in front of them when the page opens.
 *
 * `generated` is a new exercise, which is what this has always done.
 * `last` is the piece they were working on, which is the one thing a reader
 * coming back to a practice tool most often wants. `random` is his own idea,
 * from osu: something is there, and the question "shall I play this?" gets
 * asked instead of having to be thought of.
 */
export const WHAT_OPENS = ['generated', 'last', 'random'] as const;

/**
 * The orders the shelf can be read in.
 *
 * "Recent" is what it has always been and stays the default: the piece being
 * worked on is the one kept coming back to. The other two are the two questions
 * a difficulty is asked for - something to stretch on, or something readable
 * tonight - and they are one control with three answers rather than an order
 * and a direction, which would be two.
 */
export const SCORE_ORDER = ['recent', 'easiest', 'hardest'] as const;

export type ScoreOrder = (typeof SCORE_ORDER)[number];

/** The most a piece can be marked, and the least. */
export const HARDEST_STARS = 10;
export const EASIEST_STARS = 1;

/**
 * The difficulty in something the reader typed, or `null` for no mark at all.
 *
 * Held to one decimal place, which is the precision he asked for - "2.2 2.3
 * 2.7" - and the precision anybody can actually feel the difference of. Kept
 * inside one and ten rather than refused: a reader who types 15 means the
 * hardest thing there is, and a dialog that argues with them about it is a
 * dialog in the way.
 */
export function theStarsIn(typed: string): number | null {
  const wanted = Number.parseFloat(typed.trim().replace(',', '.'));
  if (!Number.isFinite(wanted)) {
    return null;
  }
  const held = Math.min(HARDEST_STARS, Math.max(EASIEST_STARS, wanted));
  return Math.round(held * 10) / 10;
}

/**
 * Which whole star a mark falls in, for the colour it is drawn in.
 *
 * The floor rather than the nearest, because that is how anybody says it: a
 * piece marked 2.7 is "a two", and 2.9 and 2.1 being the same colour while 3.0
 * moves on is what a band is. The number is printed beside it, so nothing is
 * lost to the rounding.
 */
export function theStarBand(stars: number): number {
  return Math.min(HARDEST_STARS, Math.max(EASIEST_STARS, Math.floor(stars)));
}

/**
 * The shelf in the order asked for.
 *
 * A piece nobody has judged goes last in either difficulty order, never first
 * and never treated as nought: unmarked is not easy, and the reader looking for
 * something gentle would be handed the whole of what they have never opened.
 * Among equals, and among the unmarked, the recent order is what is left -
 * every row still has a reason to be where it is.
 */
export function scoresInOrder(
  scores: readonly StoredScoreSummary[],
  order: ScoreOrder,
): readonly StoredScoreSummary[] {
  const byRecent = [...scores].sort((left, right) => right.openedAtMs - left.openedAtMs);
  if (order === 'recent') {
    return byRecent;
  }
  const harder = order === 'hardest' ? -1 : 1;
  return byRecent.sort((left, right) => {
    if (left.stars === undefined || right.stars === undefined) {
      return left.stars === right.stars ? 0 : left.stars === undefined ? 1 : -1;
    }
    return (left.stars - right.stars) * harder;
  });
}

export type WhatOpens = (typeof WHAT_OPENS)[number];

/**
 * Whether a score answers to what the reader typed.
 *
 * Every word has to appear, and in any order: his library is thirty-odd
 * arrangements with names like "Hollow Knight - City of Tears", so "city
 * tears" has to find it and a plain substring search would not. Matched
 * without regard to case or to spare spaces, because a search box is not a
 * place to be exact.
 */
/** What a score of this name is filed under. The title is the identity. */
function idFor(title: string): string {
  return `score:${title}`;
}

export function matchesSearch(title: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  const against = title.toLowerCase();
  return words.every((word) => against.includes(word));
}

/**
 * What became of a rename, said rather than thrown.
 *
 * None of these is exceptional: a reader clearing the box and pressing save
 * is asking a question, not making a mistake, and a name already taken has to
 * be *refused* rather than obeyed - this library treats the title as identity,
 * so writing one score over another is exactly what obeying would do.
 */
export type RenameOutcome = 'renamed' | 'empty' | 'taken' | 'missing';

export interface ScoreLibraryDependencies {
  readonly store: IScoreStore;
  readonly serializer: IMusicXmlSerializer;
  readonly importer: IScoreImporter;
  /**
   * Asked to keep the store whenever the library is read and holds anything -
   * on a visit, and after every change to it. Not before: a page with nothing
   * kept has nothing to ask for, and one browser asks the reader out loud.
   */
  readonly keeper: IKeepsTheStore;
}

/**
 * The scores a reader has kept, so a file is chosen from the disk once.
 *
 * Keeping the MusicXML rather than the `Exercise` is deliberate. The document
 * is what the serializer already produces and the parser already reads, and
 * the round trip is exact, so there is one representation to keep correct
 * instead of two - and what is on disk stays a format other programs
 * understand.
 *
 * The summaries are held in memory because a list is redrawn far more often
 * than it changes, and reading a database to redraw a row nobody touched is
 * work for nothing.
 */
/**
 * The places in a piece: one to a place, in the order they are played.
 *
 * A place *is* its two bars. Marking out bars 17-24 a second time is the
 * reader naming the same stretch again rather than finding a new one, so the
 * later name wins and there is still one row - two rows reading "bars 17-24"
 * are a list the reader has to tell apart by nothing at all.
 *
 * And a piece has an order. A list in the order things happened to be marked
 * out is a list to be searched; in bar order it is the piece itself, and the
 * row above the one you want is the passage before it.
 */
function placesInOrder(passages: readonly SavedPassage[]): readonly SavedPassage[] {
  const byPlace = new Map<string, SavedPassage>();
  for (const passage of passages) {
    byPlace.set(`${passage.fromBar}-${passage.toBar}`, passage);
  }
  return [...byPlace.values()].sort(
    (left, right) => left.fromBar - right.fromBar || left.toBar - right.toBar,
  );
}

export class ScoreLibrary {
  private readonly deps: ScoreLibraryDependencies;
  private summaries: readonly StoredScoreSummary[] = [];

  constructor(dependencies: ScoreLibraryDependencies) {
    this.deps = dependencies;
  }

  /** Reads what earlier visits kept. Safe to call before anything is stored. */
  async load(): Promise<void> {
    this.summaries = await this.deps.store.list();
    if (this.summaries.length > 0) {
      void this.deps.keeper.askToKeep();
    }
  }

  /**
   * Most recently opened first, and that is meant literally.
   *
   * This used to sort on the moment a score was *kept* while saying it was
   * the last one opened, which is the same order only on the day everything
   * was imported. The piece a reader is working on is the one they keep
   * coming back to, and after a month of practice it sits wherever its file
   * happened to arrive.
   */
  list(): readonly StoredScoreSummary[] {
    return [...this.summaries].sort((left, right) => right.openedAtMs - left.openedAtMs);
  }

  /** The kept scores whose names answer to what was typed, in the same order. */
  search(query: string): readonly StoredScoreSummary[] {
    return this.list().filter((score) => matchesSearch(score.title, query));
  }

  get isEmpty(): boolean {
    return this.summaries.length === 0;
  }

  /**
   * Keeps a score, replacing any earlier copy of the same piece.
   *
   * Identity is the title, because that is what a reader means by "the same
   * piece": opening the file again after editing it in MuseScore should
   * update the entry rather than leave two rows that differ invisibly.
   */
  async keep(exercise: Exercise, savedAtMs: number): Promise<StoredScoreSummary> {
    const summary: StoredScoreSummary = {
      id: idFor(exercise.title),
      title: exercise.title,
      savedAtMs,
      // Importing a file is opening it: the reader is looking at it now, and
      // a piece that went to the bottom of the list the moment it arrived
      // would be a strange thing to have just added.
      openedAtMs: savedAtMs,
      bars: measureCount(exercise),
      // A piece re-imported keeps the stretches its reader marked out: the
      // file changed, the places they are learning did not.
      passages: this.summaries.find((summary) => summary.title === exercise.title)?.passages ?? [],
    };
    await this.deps.store.write({
      ...summary,
      musicXml: this.deps.serializer.serialize(exercise),
    });
    // Through `load`, which asks for the store to be kept now that it holds
    // this.
    await this.load();
    return summary;
  }

  /** Rebuilds a kept score, or `null` when it is no longer there. */
  async open(id: string): Promise<Exercise | null> {
    const stored = await this.deps.store.read(id);
    if (stored === null) {
      return null;
    }
    // Through the ordinary parser: a score read back is a score read, and a
    // second way in would be a second set of rules to keep in step.
    return this.deps.importer.read(stored.musicXml).exercise;
  }

  /**
   * Notes that the reader has read this piece, which is what orders the list.
   *
   * Deliberately not part of `open`. The program opens a score by itself now
   * - it can be asked to put a random one on the stand when the page loads -
   * and a machine's choice is not a reading: it would push whatever it
   * offered to the top and lose the piece actually being worked on. So this
   * is called where a *reader* is doing something: choosing a score from the
   * sheet, or starting a run on one.
   *
   * By title, because that is what this library means by the same piece: the
   * id is minted from it, and a file re-exported from MuseScore replaces the
   * entry rather than sitting beside it.
   *
   * The moment is handed in rather than read from a clock, the same way
   * `keep` takes one: this application's `IClock` counts from an arbitrary
   * zero for measuring music, and "when did I last read this" is a question
   * about the calendar.
   */
  async markRead(title: string, atMs: number): Promise<void> {
    const found = this.summaries.find((summary) => summary.title === title);
    if (found === undefined) {
      return;
    }
    await this.deps.store.touch(found.id, atMs);
    // Kept in step here as well as in the store, so the list re-orders
    // without reading the database again to redraw rows nobody touched.
    this.summaries = this.summaries.map((summary) =>
      summary.id === found.id ? { ...summary, openedAtMs: atMs } : summary,
    );
  }

  /**
   * One kept score, chosen by the number given, or `null` on an empty shelf.
   *
   * The randomness is the caller's: this layer stays as testable as the rest
   * of the application, and `Math.random` belongs at the edge with the other
   * things the page has and the rules do not.
   */
  oneAtRandom(fraction: number): StoredScoreSummary | null {
    const all = this.list();
    if (all.length === 0) {
      return null;
    }
    const at = Math.min(all.length - 1, Math.max(0, Math.floor(fraction * all.length)));
    return all[at] ?? null;
  }

  /** The piece read most recently, which is the one being worked on. */
  get lastRead(): StoredScoreSummary | null {
    return this.list()[0] ?? null;
  }

  /**
   * Gives a kept score the name the reader would call it.
   *
   * MuseScore arrangements arrive called things nobody says out loud, and six
   * of his were called "Imported score" until the title was read out of the
   * credits. The new name goes into the *document*, not merely into the row:
   * the title is printed in the corner of every page, and a library that
   * disagreed with the page would be worse than either name alone.
   *
   * The record moves, because the title is this library's idea of identity -
   * which is also why a name already in use is refused instead of obeyed.
   * What the reader has read and how well is followed across separately, by
   * whoever holds it; this class knows only the scores.
   */
  async rename(id: string, title: string): Promise<RenameOutcome> {
    const wanted = title.trim();
    if (wanted === '') {
      return 'empty';
    }
    const stored = await this.deps.store.read(id);
    if (stored === null) {
      return 'missing';
    }
    if (wanted === stored.title) {
      return 'renamed';
    }
    const nextId = idFor(wanted);
    if (this.summaries.some((summary) => summary.id === nextId)) {
      return 'taken';
    }
    const exercise = this.deps.importer.read(stored.musicXml).exercise;
    await this.deps.store.write({
      ...stored,
      id: nextId,
      title: wanted,
      musicXml: this.deps.serializer.serialize({ ...exercise, title: wanted }),
    });
    // Second, and only once the new one is safely written: a rename that
    // failed halfway should cost a name, never the music.
    await this.deps.store.remove(id);
    await this.load();
    return 'renamed';
  }

  /**
   * Marks a stretch out in a score, or takes one away.
   *
   * Kept with the piece rather than with the settings: "bars 17 to 24" means
   * nothing about a different score, and a reader who opens this one again
   * next week wants the same places waiting for them.
   */
  async keepPassages(id: string, passages: readonly SavedPassage[]): Promise<void> {
    const kept = placesInOrder(passages);
    await this.deps.store.keepPassages(id, kept);
    this.summaries = this.summaries.map((summary) =>
      summary.id === id ? { ...summary, passages: kept } : summary,
    );
  }

  /**
   * Keeps how finely the click divides for one score.
   *
   * Kept with the piece for the same reason the passages are: "four clicks a
   * bar" is an answer about *this* metre, and a reader coming back to it next
   * week wants the click they settled on waiting for them rather than whatever
   * the last piece needed.
   */
  async keepTheClick(id: string, clickPattern: ClickPattern): Promise<void> {
    await this.deps.store.keepTheClick(id, clickPattern);
    this.summaries = this.summaries.map((summary) =>
      summary.id === id ? { ...summary, clickPattern } : summary,
    );
  }

  /**
   * The click a score asked for, or `null` where it has never said.
   *
   * Null rather than a default: nothing is the instruction to leave the
   * reader's own setting alone, and a default here would make every score ever
   * imported quietly override it.
   */
  theClickFor(title: string): ClickPattern | null {
    return this.summaries.find((summary) => summary.title === title)?.clickPattern ?? null;
  }

  /**
   * Keeps how hard the reader says a score is, or takes the mark off.
   *
   * Their judgement, kept with the piece, for the reason the click beside it
   * is: it is an answer about this music and it is the same answer next week.
   */
  async keepTheStars(id: string, stars: number | null): Promise<void> {
    await this.deps.store.keepTheStars(id, stars);
    this.summaries = this.summaries.map((summary) => {
      if (summary.id !== id) {
        return summary;
      }
      const { stars: _taken, ...rest } = summary;
      return stars === null ? rest : { ...rest, stars };
    });
  }

  /** How hard a score is said to be, or `null` where nobody has said. */
  theStarsFor(title: string): number | null {
    return this.summaries.find((summary) => summary.title === title)?.stars ?? null;
  }

  /**
   * The stretches marked out in a score, or none where it is not kept.
   *
   * Put in order here as well as on the way in, because a score marked out by
   * an earlier version of this program was written in whatever order the
   * reader happened to mark it, and that record is still on their device.
   */
  passagesOf(title: string): readonly SavedPassage[] {
    return placesInOrder(this.summaries.find((summary) => summary.title === title)?.passages ?? []);
  }

  async remove(id: string): Promise<void> {
    await this.deps.store.remove(id);
    await this.load();
  }

  async forget(): Promise<void> {
    await this.deps.store.clear();
    await this.load();
  }
}
