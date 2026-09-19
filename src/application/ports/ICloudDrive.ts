/** A file in the trainer's own folder on the reader's drive. */
export interface CloudFile {
  readonly id: string;
  readonly name: string;
}

/**
 * The reader's cloud drive, as much of it as the trainer may see: one folder
 * of its own, and nothing else on the drive.
 *
 * Everything but `prepare` needs the reader signed in, and signing in opens a
 * window of the provider's - which a browser allows only in answer to a press.
 * So `connect` is called from one, and everything after it in the same press
 * can rely on it.
 */
export interface ICloudDrive {
  /**
   * Whether the drive can be reached now without asking the reader anything.
   *
   * What a sync nobody pressed for depends on: signing in opens the provider's
   * window, and a browser allows that only in answer to a press.
   */
  readonly signedIn: boolean;
  /** Starts fetching what signing in needs, so a press later has it at hand. */
  prepare(): void;
  /** Signs the reader in where they are not, and finds or makes the folder. */
  connect(): Promise<void>;
  list(): Promise<readonly CloudFile[]>;
  read(id: string): Promise<string>;
  /** Writes a file: over the one with the id given, or as a new one by that name. */
  write(name: string, content: string, replacing: string | null): Promise<CloudFile>;
}
