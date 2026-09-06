/**
 * A stretch of a piece the reader means to learn, and what they call it.
 *
 * His line 47. A piece is learned in places rather than all at once - the
 * turn on page two, the run in the left hand - and setting the same two bar
 * numbers by hand every evening is the part of that which is not practice.
 */
export interface SavedPassage {
  readonly name: string;
  readonly fromBar: number;
  readonly toBar: number;
}

/** What the library knows about a score without opening it. */
export interface StoredScoreSummary {
  readonly id: string;
  readonly title: string;
  /** Wall-clock moment it was kept, for saying how long it has been here. */
  readonly savedAtMs: number;
  /**
   * Wall-clock moment it was last opened, which is what "recent" means.
   *
   * Not the same question as when it was kept, and the difference is the
   * whole point: a file imported in March and read every day is the reader's
   * current piece, and one imported yesterday and never opened again is not.
   * A store that has only ever seen the older shape answers with the moment
   * it was kept, which is the truth it has.
   */
  readonly openedAtMs: number;
  readonly bars: number;
  /** Stretches the reader has marked out in it, in the order they saved them. */
  readonly passages: readonly SavedPassage[];
}

/**
 * A kept score, and the MusicXML it is rebuilt from.
 *
 * The *document* is stored rather than a serialised `Exercise`, because the
 * round trip through this project's own serializer and parser is exact - a
 * hundred bars of the real test file come back byte for byte - and it is
 * already covered by tests. A second encoding of the same thing would be a
 * second thing to keep correct, and the format on disk would stop being one
 * anybody else could read.
 */
export interface StoredScore extends StoredScoreSummary {
  readonly musicXml: string;
}

/**
 * Somewhere to keep opened scores between visits.
 *
 * Asynchronous throughout, and that is not incidental: a hundred-bar piece is
 * a few hundred kilobytes, which is more than browser key-value storage will
 * hold beside the settings - so the only real implementation is a database,
 * and a database is asynchronous.
 */
export interface IScoreStore {
  list(): Promise<readonly StoredScoreSummary[]>;
  read(id: string): Promise<StoredScore | null>;
  write(score: StoredScore): Promise<void>;
  /**
   * Keeps the stretches a reader has marked out in a score.
   *
   * Separate from `write` for the same reason `touch` is: the caller is
   * holding a list of bar numbers, not a hundred kilobytes of MusicXML.
   */
  keepPassages(id: string, passages: readonly SavedPassage[]): Promise<void>;

  /**
   * Marks a score as opened just now.
   *
   * Separate from `write` because the caller has no reason to be holding the
   * document: a reader opening a score has just been given the music back,
   * and handing the whole of it in again to change one number would be
   * asking them to carry it twice.
   */
  touch(id: string, atMs: number): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** Keeps them in a map, for tests and for a browser with no database. */
export class InMemoryScoreStore implements IScoreStore {
  private readonly scores = new Map<string, StoredScore>();

  list(): Promise<readonly StoredScoreSummary[]> {
    return Promise.resolve(
      [...this.scores.values()].map(({ musicXml: _musicXml, ...summary }) => summary),
    );
  }

  read(id: string): Promise<StoredScore | null> {
    return Promise.resolve(this.scores.get(id) ?? null);
  }

  write(score: StoredScore): Promise<void> {
    this.scores.set(score.id, score);
    return Promise.resolve();
  }

  touch(id: string, atMs: number): Promise<void> {
    const found = this.scores.get(id);
    if (found !== undefined) {
      this.scores.set(id, { ...found, openedAtMs: atMs });
    }
    return Promise.resolve();
  }

  keepPassages(id: string, passages: readonly SavedPassage[]): Promise<void> {
    const found = this.scores.get(id);
    if (found !== undefined) {
      this.scores.set(id, { ...found, passages });
    }
    return Promise.resolve();
  }

  remove(id: string): Promise<void> {
    this.scores.delete(id);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.scores.clear();
    return Promise.resolve();
  }
}
