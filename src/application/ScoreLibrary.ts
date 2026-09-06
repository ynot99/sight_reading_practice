import { measureCount } from '../domain/model/Exercise.js';
import type { Exercise } from '../domain/model/Exercise.js';
import type { IMusicXmlSerializer } from '../domain/notation/MusicXmlSerializer.js';
import type { IScoreImporter } from './ports/IScoreImporter.js';
import type { IScoreStore, StoredScoreSummary } from './ports/IScoreStore.js';

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
export class ScoreLibrary {
  private readonly deps: ScoreLibraryDependencies;
  private summaries: readonly StoredScoreSummary[] = [];

  constructor(dependencies: ScoreLibraryDependencies) {
    this.deps = dependencies;
  }

  /** Reads what earlier visits kept. Safe to call before anything is stored. */
  async load(): Promise<void> {
    this.summaries = await this.deps.store.list();
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
    };
    await this.deps.store.write({
      ...summary,
      musicXml: this.deps.serializer.serialize(exercise),
    });
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

  async remove(id: string): Promise<void> {
    await this.deps.store.remove(id);
    await this.load();
  }

  async forget(): Promise<void> {
    await this.deps.store.clear();
    await this.load();
  }
}
