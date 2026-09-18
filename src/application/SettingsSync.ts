import type { ICloudDrive } from './ports/ICloudDrive.js';
import type { PracticeSettings } from './PracticeController.js';
import type { SettingsRepository, SharedSettings } from './SettingsRepository.js';

const FILE = 'settings.json';
const VERSION = 1;

export type SettingsSyncOutcome = 'sent' | 'brought' | 'same';

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

  async sync(): Promise<SettingsSyncOutcome> {
    const { drive, settings } = this.deps;
    await drive.connect();
    const file = (await drive.list()).find((each) => each.name === FILE);
    const theirs = file === undefined ? null : readSettings(await drive.read(file.id));
    const mine = settings.sharedSettings();
    if (
      theirs !== null &&
      (theirs.changedAtMs > mine.changedAtMs || (mine.changedAtMs === 0 && theirs.changedAtMs === 0))
    ) {
      if (JSON.stringify(theirs.values) === JSON.stringify(mine.values)) {
        return 'same';
      }
      this.deps.apply(settings.adoptSettings(theirs));
      return 'brought';
    }
    if (theirs !== null && theirs.changedAtMs === mine.changedAtMs) {
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
