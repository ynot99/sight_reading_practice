import type { ICloudDrive } from './ports/ICloudDrive.js';
import type { PracticeSettings } from './PracticeController.js';
import type { SettingsRepository, SharedSettings } from './SettingsRepository.js';
import type { SyncProgress } from './SyncProgress.js';

const FILE = 'settings.json';
const VERSION = 1;

export type SettingsSyncOutcome = 'sent' | 'brought' | 'same';

/** The most a sync of the settings asks the drive: the folder listed, the settings read, and written. */
export const SETTINGS_REQUESTS_AT_MOST = 3;

export interface SettingsSyncDependencies {
  readonly drive: ICloudDrive;
  readonly settings: SettingsRepository;
  /** Puts settings taken from the drive in front of the reader. */
  readonly apply: (practice: Partial<PracticeSettings>) => void;
}

/**
 * Keeps the settings the same on every device, except what belongs to one.
 *
 * His reason: settings that follow him between devices without a backup made
 * by hand. The newer change wins, as a whole: settings are chosen together,
 * and a mixture of two devices' choices is one neither of them made. A device
 * on which nothing has changed since changes were timed takes the drive's, so
 * a new device starts from where the others are.
 */
export class SettingsSync {
  private readonly deps: SettingsSyncDependencies;

  constructor(dependencies: SettingsSyncDependencies) {
    this.deps = dependencies;
  }

  /** One sync of the settings, its requests to the drive counted by `progress` where one is given. */
  async sync(progress?: SyncProgress): Promise<SettingsSyncOutcome> {
    const { settings } = this.deps;
    const drive = progress === undefined ? this.deps.drive : progress.counting(this.deps.drive);
    await drive.connect();
    const file = (await drive.list()).find((each) => each.name === FILE);
    if (file === undefined) {
      progress?.spare(1);
    }
    const theirs = file === undefined ? null : readSettings(await drive.read(file.id));
    const mine = settings.sharedSettings();
    if (
      theirs !== null &&
      (theirs.changedAtMs > mine.changedAtMs || (mine.changedAtMs === 0 && theirs.changedAtMs === 0))
    ) {
      progress?.spare(1);
      if (JSON.stringify(theirs.values) === JSON.stringify(mine.values)) {
        return 'same';
      }
      this.deps.apply(settings.adoptSettings(theirs));
      return 'brought';
    }
    if (theirs !== null && theirs.changedAtMs === mine.changedAtMs) {
      progress?.spare(1);
      return 'same';
    }
    await drive.write(
      FILE,
      JSON.stringify({ version: VERSION, changedAtMs: mine.changedAtMs, practice: mine.values }),
      file?.id ?? null,
    );
    return 'sent';
  }
}

/** The drive's settings, or nothing where they do not hold together. */
function readSettings(text: string): SharedSettings | null {
  try {
    const parsed = JSON.parse(text) as { changedAtMs?: unknown; practice?: unknown } | null;
    if (
      parsed === null ||
      typeof parsed.changedAtMs !== 'number' ||
      typeof parsed.practice !== 'object' ||
      parsed.practice === null
    ) {
      return null;
    }
    return { values: parsed.practice as Record<string, unknown>, changedAtMs: parsed.changedAtMs };
  } catch {
    return null;
  }
}
