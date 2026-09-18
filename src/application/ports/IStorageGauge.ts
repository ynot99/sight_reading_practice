/**
 * How much this program keeps on the device, as far as the browser will say.
 *
 * Read on request rather than watched: it answers a question the reader asks
 * - is there room, and will it be kept - and asking the browser costs a
 * moment that nothing else should pay.
 */
export interface StorageReading {
  /**
   * Everything the site keeps: the database of scores, the offline copy of
   * the app, the piano samples. `null` where the browser will not say.
   */
  readonly usedBytes: number | null;
  /** How much the browser would let the site keep. `null` where it will not say. */
  readonly quotaBytes: number | null;
  /** The database of scores alone, where the browser breaks it out. */
  readonly databaseBytes: number | null;
  /**
   * Whether the browser has promised not to clear it to make room, or after
   * a week unvisited. `null` where it will not say.
   */
  readonly persisted: boolean | null;
  /**
   * The small store, shelf by shelf: settings, readings, takes. A few
   * megabytes for the whole site, and a shelf that fills it stops the others
   * being written too.
   */
  readonly shelves: readonly StorageShelf[];
}

/** One shelf of the small store, by how many characters it holds. */
export interface StorageShelf {
  readonly name: string;
  readonly characters: number;
}

export interface IStorageGauge {
  read(): Promise<StorageReading>;
}

/**
 * Asks the browser to keep this site's data rather than clear it.
 *
 * A browser may clear a site's store to make room, and Safari clears one the
 * reader has not visited for a week unless the page was added to the Home
 * Screen. Nothing in the store is anywhere else: a library of scores with a
 * difficulty given to each, marked out passages, the click each one likes.
 */
export interface IKeepsTheStore {
  /** Whether it will be kept, or `null` where the browser will not say. */
  askToKeep(): Promise<boolean | null>;
}
