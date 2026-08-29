import { measureCount } from '../domain/model/Exercise.js';
import type { Exercise } from '../domain/model/Exercise.js';
import type { IMusicXmlSerializer } from '../domain/notation/MusicXmlSerializer.js';
import type { IScoreImporter } from './ports/IScoreImporter.js';
import type { IScoreStore, StoredScoreSummary } from './ports/IScoreStore.js';

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

  /** Newest first: the score a reader wants is usually the last one opened. */
  list(): readonly StoredScoreSummary[] {
    return [...this.summaries].sort((left, right) => right.savedAtMs - left.savedAtMs);
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

  async remove(id: string): Promise<void> {
    await this.deps.store.remove(id);
    await this.load();
  }

  async forget(): Promise<void> {
    await this.deps.store.clear();
    await this.load();
  }
}
