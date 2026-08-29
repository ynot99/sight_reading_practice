/** What the library knows about a score without opening it. */
export interface StoredScoreSummary {
  readonly id: string;
  readonly title: string;
  /** Wall-clock moment it was kept, for ordering and for saying "when". */
  readonly savedAtMs: number;
  readonly bars: number;
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

  remove(id: string): Promise<void> {
    this.scores.delete(id);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.scores.clear();
    return Promise.resolve();
  }
}
