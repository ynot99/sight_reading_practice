import type { IClock } from './ports/IClock.js';
import type { ISettingsStore } from './ports/ISettingsStore.js';
import type { IScoreStore, StoredScore } from './ports/IScoreStore.js';

export const BACKUP_KIND = 'sight-reading-practice.backup';
export const BACKUP_VERSION = 1;

/**
 * Everything this application keeps, in one file.
 *
 * Kept as *what the stores hold* rather than as what any of it means. Each
 * store already deals in an opaque blob and a codec already deals in the
 * meaning, so a backup that understood settings would be a third thing to
 * keep in step with the other two - and would need changing every time a
 * setting was added. This one does not.
 *
 * Scores are the exception, and only because they do not live in the same
 * kind of store: a hundred-bar piece is more than browser key-value storage
 * will hold, so they live in a database and have to be listed out.
 */
export interface BackupDocument {
  readonly kind: typeof BACKUP_KIND;
  readonly version: number;
  readonly savedAtMs: number;
  /** Each store's blob, under the key it lives at. */
  readonly stores: Readonly<Record<string, unknown>>;
  readonly scores: readonly StoredScore[];
}

/** What a restore actually put back, so the reader is told rather than assured. */
export interface RestoreSummary {
  readonly stores: number;
  readonly scoresAdded: number;
  readonly scoresAlreadyHere: number;
}

export interface BackupServiceDependencies {
  /** Every key-value store, by the key it is kept under. */
  readonly stores: ReadonlyMap<string, ISettingsStore>;
  readonly scoreStore: IScoreStore;
  readonly clock: IClock;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readScore(value: unknown): StoredScore | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, title, savedAtMs, bars, musicXml } = value;
  if (typeof id !== 'string' || typeof musicXml !== 'string' || musicXml === '') {
    return null;
  }
  return {
    id,
    title: typeof title === 'string' ? title : 'Untitled',
    savedAtMs: typeof savedAtMs === 'number' ? savedAtMs : 0,
    bars: typeof bars === 'number' ? bars : 0,
    musicXml,
  };
}

/**
 * Reads a backup file, or says why it is not one.
 *
 * Separate from restoring it, because "is this the right file" and "put it
 * back" fail for different reasons and a reader deserves to be told which.
 */
export function readBackup(value: unknown): BackupDocument {
  if (!isRecord(value) || value['kind'] !== BACKUP_KIND) {
    throw new Error('That file is not a backup of this application.');
  }
  const version = value['version'];
  if (typeof version !== 'number' || version > BACKUP_VERSION) {
    throw new Error('That backup was written by a newer version of this application.');
  }
  const stores = isRecord(value['stores']) ? value['stores'] : {};
  const scores = Array.isArray(value['scores'])
    ? value['scores'].map(readScore).filter((score): score is StoredScore => score !== null)
    : [];

  return {
    kind: BACKUP_KIND,
    version,
    savedAtMs: typeof value['savedAtMs'] === 'number' ? value['savedAtMs'] : 0,
    stores,
    scores,
  };
}

/**
 * Carries everything off this device, and back onto another one.
 *
 * The reason this exists: installing the page to a Home Screen gives it a
 * store of its own, separate from the browser tab it was installed from. A
 * reader who had been practising in the tab opened the app and found their
 * levels, their kept scores and their takes all gone - not lost, but somewhere
 * the new window cannot reach. Nothing in a browser can bridge that; a file
 * can.
 */
export class BackupService {
  private readonly stores: ReadonlyMap<string, ISettingsStore>;
  private readonly scoreStore: IScoreStore;
  private readonly clock: IClock;

  constructor(dependencies: BackupServiceDependencies) {
    this.stores = dependencies.stores;
    this.scoreStore = dependencies.scoreStore;
    this.clock = dependencies.clock;
  }

  async create(): Promise<BackupDocument> {
    const stores: Record<string, unknown> = {};
    for (const [key, store] of this.stores) {
      const value = store.read();
      if (value !== null && value !== undefined) {
        stores[key] = value;
      }
    }

    const summaries = await this.scoreStore.list();
    const scores: StoredScore[] = [];
    for (const summary of summaries) {
      const score = await this.scoreStore.read(summary.id);
      if (score !== null) {
        scores.push(score);
      }
    }

    return {
      kind: BACKUP_KIND,
      version: BACKUP_VERSION,
      savedAtMs: this.clock.now(),
      stores,
      scores,
    };
  }

  /**
   * Puts a backup back.
   *
   * Settings are replaced and libraries are merged, which is the difference
   * between the two kinds of thing: there is one answer to "which level am I
   * on" and the file has it, while a score kept since the backup was written
   * is not something a restore has any business deleting. A score already
   * here is left exactly as it is, so restoring the same file twice changes
   * nothing the second time.
   */
  async restore(document: BackupDocument): Promise<RestoreSummary> {
    let written = 0;
    for (const [key, store] of this.stores) {
      const value = document.stores[key];
      if (value !== undefined) {
        store.write(value);
        written += 1;
      }
    }

    let added = 0;
    let alreadyHere = 0;
    for (const score of document.scores) {
      if ((await this.scoreStore.read(score.id)) !== null) {
        alreadyHere += 1;
        continue;
      }
      await this.scoreStore.write(score);
      added += 1;
    }

    return { stores: written, scoresAdded: added, scoresAlreadyHere: alreadyHere };
  }
}
