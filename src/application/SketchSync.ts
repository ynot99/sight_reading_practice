import type { CloudFile, ICloudDrive } from './ports/ICloudDrive.js';
import { sketchAsKept, sketchFromKept, type SketchLibrary, type StoredSketch } from './SketchLibrary.js';

/** The one file on the drive that holds every sketch. */
export const SKETCHES_FILE = 'sketches.json';
const VERSION = 1;

/** What a copy of a sketch changed on two devices at once is called, after its own name. */
export const CONFLICTING_COPY = 'conflicting copy';

/** A sketch as the drive has it: the sketch, and the revision of it the drive is at. */
interface SketchThere {
  readonly sketch: StoredSketch;
  readonly revision: number;
}

/** A sketch the drive has and this device does not, for the reader to bring here or leave. */
export interface SketchOnTheDrive {
  readonly id: string;
  readonly title: string;
  readonly begunAtMs: number;
  readonly noteCount: number;
}

export interface SketchSyncOutcome {
  /** Sketches the drive has had from this device. */
  readonly sent: number;
  /** Sketches here this device took a newer copy of from the drive. */
  readonly brought: number;
  /** Sketches changed here and elsewhere at once, kept here as a copy beside the drive's. */
  readonly conflicts: number;
  /** Sketches the drive has and this device does not, newest first. */
  readonly onlyOnTheDrive: readonly SketchOnTheDrive[];
}

export interface SketchSyncDependencies {
  readonly drive: ICloudDrive;
  readonly sketches: SketchLibrary;
}

/**
 * Keeps the sketches on every device that has them the same, through one
 * file on the drive - as the scores are kept, and with the scores' rule for
 * what a device has: a sketch only the drive has is not brought here unasked,
 * but offered, and deleting one here takes it off this device only.
 *
 * A sketch is changed far more often than a score, and on either device, so
 * "the newer one wins" would lose whatever the other device had done. So
 * each sketch carries a revision the drive counts, and a device remembers the
 * revision its copy was last in step with, and whether it has changed it
 * since - no device's clock is set against another's. Then:
 *
 * - A sketch only here goes to the drive.
 * - Changed here, and still at the drive's revision: sent, a revision on.
 *   At an older revision and not changed here: the drive's is taken.
 * - Changed here *and* on the drive since: both kept. The drive's is taken
 *   under its own name, and this device's becomes a copy beside it, named
 *   so, and sent as a new sketch - the writer chooses which to keep.
 *
 * The sketch open in the editor is not taken from the drive underneath it -
 * its undo is of what is here - and waits for the next sync. That a sketch is
 * sent is marked here once the drive has it, so a sync that fails partway is
 * simply done again.
 */
export class SketchSync {
  private readonly deps: SketchSyncDependencies;

  constructor(dependencies: SketchSyncDependencies) {
    this.deps = dependencies;
  }

  /** One sync, leaving as it is the sketch open on the page (`open`), if any. */
  async sync(open: string | null): Promise<SketchSyncOutcome> {
    const { sketches: library } = this.deps;
    const { file, there } = await this.readTheDrive();

    const next = new Map<string, SketchThere>(there);
    // Settled here only once the drive has it.
    const sentAt: [string, number][] = [];
    let brought = 0;
    let conflicts = 0;

    for (const mine of library.forTheDrive()) {
      const { sketch } = mine;
      const theirs = there.get(sketch.id);
      const send = (revision: number): void => {
        next.set(sketch.id, { sketch, revision });
        sentAt.push([sketch.id, revision]);
      };
      if (theirs === undefined) {
        send(mine.revision + 1);
      } else if (theirs.revision > mine.revision) {
        if (sketch.id === open) {
          continue;
        }
        if (mine.unsent) {
          const copy = library.keepACopy(sketch.id, `${sketch.title} (${CONFLICTING_COPY})`);
          if (copy !== null) {
            next.set(copy.id, { sketch: copy, revision: 1 });
            sentAt.push([copy.id, 1]);
            conflicts += 1;
          }
        }
        library.takeFromTheDrive(theirs.sketch, theirs.revision);
        brought += 1;
      } else if (mine.unsent || theirs.revision < mine.revision) {
        send(Math.max(mine.revision, theirs.revision) + 1);
      }
    }

    if (sentAt.length > 0) {
      await this.deps.drive.write(SKETCHES_FILE, writeTheDrive(next), file?.id ?? null);
    }
    for (const [id, revision] of sentAt) {
      library.sentAt(id, revision);
    }
    return { sent: sentAt.length, brought, conflicts, onlyOnTheDrive: onlyOnTheDrive(next, library) };
  }

  /** Takes a sketch the drive has onto this device, as the drive has it now. */
  async bringHere(id: string): Promise<void> {
    const theirs = (await this.readTheDrive()).there.get(id);
    if (theirs === undefined) {
      throw new Error('That sketch is no longer on the drive.');
    }
    this.deps.sketches.takeFromTheDrive(theirs.sketch, theirs.revision);
  }

  private async readTheDrive(): Promise<{
    readonly file: CloudFile | undefined;
    readonly there: ReadonlyMap<string, SketchThere>;
  }> {
    const { drive } = this.deps;
    await drive.connect();
    const file = (await drive.list()).find((each) => each.name === SKETCHES_FILE);
    return { file, there: file === undefined ? new Map() : readTheDrive(await drive.read(file.id)) };
  }
}

/** What the drive has that the library here does not, newest first. */
function onlyOnTheDrive(there: ReadonlyMap<string, SketchThere>, library: SketchLibrary): readonly SketchOnTheDrive[] {
  return [...there.values()]
    .filter(({ sketch }) => library.find(sketch.id) === null)
    .map(({ sketch }) => ({ id: sketch.id, title: sketch.title, begunAtMs: sketch.begunAtMs, noteCount: sketch.noteCount }))
    .sort((one, other) => other.begunAtMs - one.begunAtMs);
}

function writeTheDrive(sketches: ReadonlyMap<string, SketchThere>): string {
  return JSON.stringify({
    version: VERSION,
    sketches: [...sketches.values()].map(({ sketch, revision }) => ({ ...sketchAsKept(sketch), revision })),
  });
}

/**
 * The drive's file, read as carefully as anything a program did not write
 * itself: an entry that does not hold together is left out rather than
 * trusted, and a file that is not one at all is an empty drive.
 */
function readTheDrive(text: string): ReadonlyMap<string, SketchThere> {
  const sketches = new Map<string, SketchThere>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return sketches;
  }
  const read = parsed as { sketches?: unknown } | null;
  for (const entry of Array.isArray(read?.sketches) ? (read.sketches as unknown[]) : []) {
    const sketch = sketchFromKept(entry);
    const revision = (entry as { revision?: unknown } | null)?.revision;
    if (sketch !== null && typeof revision === 'number' && Number.isInteger(revision) && revision > 0) {
      sketches.set(sketch.id, { sketch, revision });
    }
  }
  return sketches;
}
