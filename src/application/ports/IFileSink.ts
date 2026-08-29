/**
 * Somewhere to hand the reader a finished file.
 *
 * A port because saving is the one thing in this application that leaves the
 * page: in a browser it is a blob and a click the code makes on the reader's
 * behalf, in a test it is an array. Nothing above this line should know which.
 */
export interface IFileSink {
  save(fileName: string, bytes: Uint8Array, mimeType: string): void;
}

/** Remembers what it was asked to save, for tests and headless runs. */
export class RecordingFileSink implements IFileSink {
  readonly saved: { fileName: string; bytes: Uint8Array; mimeType: string }[] = [];

  save(fileName: string, bytes: Uint8Array, mimeType: string): void {
    this.saved.push({ fileName, bytes, mimeType });
  }
}
