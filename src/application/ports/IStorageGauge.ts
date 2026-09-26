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
  /**
   * What it is made of, part by part, as far as each part could be weighed.
   *
   * Weighed by the program rather than asked of the browser, because the
   * browser will not say: Safari gives one total and nothing broken out, and
   * the scores, the readings and the takes all lie in one database whatever
   * the browser says of it. So each is about its size - see the gauge for how
   * each is counted - and what the parts do not account for of the total is
   * the browser's own keeping.
   */
  readonly parts: readonly StoragePart[];
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

/** What a part of the site's keeping is. */
export type StoragePartKind = 'scores' | 'readings' | 'takes' | 'sound' | 'app' | 'settings';

/** One part of what the site keeps, and about how much of it there is. */
export interface StoragePart {
  readonly kind: StoragePartKind;
  readonly bytes: number;
  /** How many of it there are, where that is worth saying: scores, readings, takes. */
  readonly count: number | null;
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
