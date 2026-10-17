import type { ICloudDrive } from './ports/ICloudDrive.js';

/** How far a sync has got, as the reader is shown it. */
export interface SyncProgressShown {
  /** Requests the drive has answered so far. */
  readonly answered: number;
  /** How many it will have been asked in all, or `null` while that is not yet known. */
  readonly expected: number | null;
}

/**
 * Counts a sync's requests to the drive as they are answered, against how
 * many it will make.
 *
 * The requests are what a sync waits on: a score settled without asking the
 * drive anything takes no time worth showing, and counting scores sent a bar
 * nearly to its end in a moment and left it there while the drive was
 * written. How many there will be is known only once the drive's list of
 * scores has been read, so until then there is no measure, and what comes
 * after that list - the settings and the sketches - is held back as the most
 * it can take and given back as each request turns out not to be needed.
 * So the share answered only grows, but where another device writes the
 * sketches meanwhile and the sync is settled again, or a document the
 * drive's list names has to be looked for in the folder.
 */
export class SyncProgress {
  private readonly tell: (shown: SyncProgressShown) => void;
  private answered = 0;
  private expected: number | null = null;
  /** Requests to come after the part not yet measured, as many as they can be. */
  private readonly heldBack: number;

  constructor(tell: (shown: SyncProgressShown) => void, heldBack = 0) {
    this.tell = tell;
    this.heldBack = heldBack;
  }

  /** Requests still to come, beside those already expected: the first such word is the measure. */
  expect(requests: number): void {
    this.expected = (this.expected ?? this.answered + this.heldBack) + requests;
    this.say();
  }

  /**
   * Requests that were expected and turned out not to be needed. Nothing is
   * found not to be needed before there is a measure: what takes it is
   * synced first.
   */
  spare(requests: number): void {
    if (this.expected === null) {
      return;
    }
    this.expected -= requests;
    this.say();
  }

  /** The drive as a sync asks it, each answer it gives counted here. */
  counting(drive: ICloudDrive): ICloudDrive {
    const answered = async <T>(asked: Promise<T>): Promise<T> => {
      const answer = await asked;
      this.answered += 1;
      this.say();
      return answer;
    };
    return {
      get signedIn() {
        return drive.signedIn;
      },
      prepare: () => {
        drive.prepare();
      },
      // Signing in is the reader's to answer, not the drive's, and how long
      // that takes is nobody's to measure.
      connect: () => drive.connect(),
      list: () => answered(drive.list()),
      read: (id) => answered(drive.read(id)),
      write: (name, content, replacing) => answered(drive.write(name, content, replacing)),
      trash: (id) => answered(drive.trash(id)),
    };
  }

  private say(): void {
    this.tell({
      answered: this.answered,
      expected: this.expected,
    });
  }
}
