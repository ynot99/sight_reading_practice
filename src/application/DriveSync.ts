import type { LibrarySync, SyncOutcome } from './LibrarySync.js';
import type { StoredScoreSummary } from './ports/IScoreStore.js';
import type { SettingsRepository } from './SettingsRepository.js';
import type { SettingsSync, SettingsSyncOutcome } from './SettingsSync.js';

export interface DriveSyncOutcome {
  readonly library: SyncOutcome;
  readonly settings: SettingsSyncOutcome;
}

export interface DriveSyncDependencies {
  readonly library: Pick<LibrarySync, 'sync'>;
  readonly settings: Pick<SettingsSync, 'sync'>;
  /** The scores kept here, as they stand. */
  readonly scores: () => readonly StoredScoreSummary[];
  /** When the shared settings last changed, and where the last sync is remembered. */
  readonly repository: SettingsRepository;
  /** Wall-clock milliseconds. */
  readonly now: () => number;
}

/**
 * One sync of everything the drive carries, and whether this device has
 * anything the drive has not yet had.
 *
 * Only this device's side can be known without signing in: what another
 * device has sent is on the drive, and the drive is not asked until the
 * reader presses. So "something to sync" means something changed *here* since
 * the last sync - a score kept, its marks, a shared setting. Opening a piece
 * is not a change worth asking for: it travels with the next sync all the
 * same.
 */
export class DriveSync {
  private readonly deps: DriveSyncDependencies;

  constructor(dependencies: DriveSyncDependencies) {
    this.deps = dependencies;
  }

  async sync(progress?: (done: number, total: number) => void): Promise<DriveSyncOutcome> {
    const library = await this.deps.library.sync(progress);
    const settings = await this.deps.settings.sync();
    // At least as late as anything now here: a score brought from a device
    // whose clock runs ahead would otherwise look like a change made since.
    this.deps.repository.rememberTheSync(Math.max(this.deps.now(), this.latestChange()));
    return { library, settings };
  }

  get hasSomethingToSync(): boolean {
    const last = this.deps.repository.lastSyncedAtMs;
    if (last === null) {
      return this.deps.scores().length > 0 || this.deps.repository.sharedSettings().changedAtMs > 0;
    }
    return this.latestChange() > last;
  }

  private latestChange(): number {
    let latest = this.deps.repository.sharedSettings().changedAtMs;
    for (const score of this.deps.scores()) {
      latest = Math.max(latest, score.savedAtMs, score.markedAtMs ?? 0);
    }
    return latest;
  }
}
