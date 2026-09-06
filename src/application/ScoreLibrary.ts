import { measureCount } from '../domain/model/Exercise.js';
import type { Exercise } from '../domain/model/Exercise.js';
import type { IMusicXmlSerializer } from '../domain/notation/MusicXmlSerializer.js';
import type { IScoreImporter } from './ports/IScoreImporter.js';
import type { IScoreStore, StoredScoreSummary } from './ports/IScoreStore.js';

/**
 * Whether a score answers to what the reader typed.
 *
 * Every word has to appear, and in any order: his library is thirty-odd
 * arrangements with names like "Hollow Knight - City of Tears", so "city
 * tears" has to find it and a plain substring search would not. Matched
 * without regard to case or to spare spaces, because a search box is not a
 * place to be exact.
 */
export function matchesSearch(title: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  const against = title.toLowerCase();
  return words.every((word) => against.includes(word));
}

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
      id: `score:${exercise.title}`,
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

  /**
   * Rebuilds a kept score, or `null` when it is no longer there.
   *
   * The moment is handed in rather than read from a clock here, the same way
   * `keep` takes one: this application's `IClock` counts from an arbitrary
   * zero for measuring music, and "when did I last read this" is a question
   * about the calendar.
   */
  async open(id: string, openedAtMs: number): Promise<Exercise | null> {
    const stored = await this.deps.store.read(id);
    if (stored === null) {
      return null;
    }
    await this.deps.store.touch(id, openedAtMs);
    // Kept in step here as well as in the store, so the list re-orders
    // without reading the database again to redraw rows nobody touched.
    this.summaries = this.summaries.map((summary) =>
      summary.id === id ? { ...summary, openedAtMs } : summary,
    );
    // Through the ordinary parser: a score read back is a score read, and a
    // second way in would be a second set of rules to keep in step.
    return this.deps.importer.read(stored.musicXml).exercise;
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
