import type { LibrarySync, SyncOutcome } from './LibrarySync.js';
import type { StoredScoreSummary } from './ports/IScoreStore.js';
import type { SettingsRepository } from './SettingsRepository.js';
import { SETTINGS_REQUESTS_AT_MOST, type SettingsSync, type SettingsSyncOutcome } from './SettingsSync.js';
import { SKETCH_REQUESTS_AT_MOST, type SketchSync, type SketchSyncOutcome } from './SketchSync.js';
import { SyncProgress, type SyncProgressShown } from './SyncProgress.js';

/**
 * How long after the last change here the Sync button presses itself.
 *
 * Long enough that a run of changes - stars given to three scores, a setting
 * tried and put back - goes in one sync rather than one each. His: "auto sync
 * з debounce у 30 секунд".
 */
export const SYNC_AFTER_QUIET_MS = 30_000;

export interface DriveSyncOutcome {
  readonly library: SyncOutcome;
  readonly settings: SettingsSyncOutcome;
  readonly sketches: SketchSyncOutcome;
}

export interface DriveSyncDependencies {
  readonly library: Pick<LibrarySync, 'sync'>;
  readonly settings: Pick<SettingsSync, 'sync'>;
  readonly sketches: Pick<SketchSync, 'sync'>;
  /** When the sketches were last changed here with the drive not yet told, or `null`: see `SketchLibrary.unsentSinceMs`. */
  readonly sketchesUnsentSinceMs: () => number | null;
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

  /**
   * One sync of everything, leaving as it is the sketch open on the page
   * (`openSketch`): see `SketchSync`. How far it has got is told as it goes,
   * in requests to the drive: see `SyncProgress`.
   */
  async sync(tell?: (shown: SyncProgressShown) => void, openSketch: string | null = null): Promise<DriveSyncOutcome> {
    // The library is synced first, and the settings and the sketches after
    // it are held back for until it knows how much it will ask.
    const progress =
      tell === undefined ? undefined : new SyncProgress(tell, SETTINGS_REQUESTS_AT_MOST + SKETCH_REQUESTS_AT_MOST);
    const library = await this.deps.library.sync(progress);
    const settings = await this.deps.settings.sync(progress);
    const sketches = await this.deps.sketches.sync(openSketch, progress);
    // At least as late as anything now here: a score brought from a device
    // whose clock runs ahead would otherwise look like a change made since.
    this.deps.repository.rememberTheSync(Math.max(this.deps.now(), this.latestChange()));
    return { library, settings, sketches };
  }

  /**
   * When a sync nobody pressed for is due: half a minute after the last change
   * here, and every change puts it off again. `null` while the drive has had
   * everything.
   */
  get dueAtMs(): number | null {
    return this.hasSomethingToSync ? this.latestChange() + SYNC_AFTER_QUIET_MS : null;
  }

  /** The moment of the last change here: a score kept, its marks, a shared setting. */
  get latestChangeAtMs(): number {
    return this.latestChange();
  }

  get hasSomethingToSync(): boolean {
    // A sketch says itself whether the drive has had it, whatever the clocks.
    if (this.deps.sketchesUnsentSinceMs() !== null) {
      return true;
    }
    const last = this.deps.repository.lastSyncedAtMs;
    if (last === null) {
      return this.deps.scores().length > 0 || this.deps.repository.sharedSettings().changedAtMs > 0;
    }
    return this.latestChange() > last;
  }

  private latestChange(): number {
    let latest = Math.max(this.deps.repository.sharedSettings().changedAtMs, this.deps.sketchesUnsentSinceMs() ?? 0);
    for (const score of this.deps.scores()) {
      latest = Math.max(latest, score.savedAtMs, score.markedAtMs ?? 0);
    }
    return latest;
  }
}
