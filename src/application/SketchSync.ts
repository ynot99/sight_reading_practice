import type { CloudFile, ICloudDrive } from './ports/ICloudDrive.js';
import { sketchAsKept, sketchFromKept, type SketchLibrary, type StoredSketch } from './SketchLibrary.js';

/** The one file on the drive that holds every sketch, and every one deleted. */
export const SKETCHES_FILE = 'sketches.json';
const VERSION = 1;

/** What a copy of a sketch changed on two devices at once is called, after its own name. */
export const CONFLICTING_COPY = 'conflicting copy';

/** A sketch as the drive has it: the sketch, and the revision of it the drive is at. */
interface SketchThere {
  readonly sketch: StoredSketch;
  readonly revision: number;
}

/** What the drive holds: the sketches, and those deleted with the revision each was at. */
interface TheDrivesSketches {
  readonly sketches: ReadonlyMap<string, SketchThere>;
  readonly deleted: ReadonlyMap<string, number>;
}

export interface SketchSyncOutcome {
  /** Sketches, and deletions, the drive has had from this device. */
  readonly sent: number;
  /** Sketches this device took from the drive: new ones, and newer ones. */
  readonly brought: number;
  /** Sketches taken off this device because another deleted them. */
  readonly takenOff: number;
  /** Sketches changed here and elsewhere at once, kept here as a copy beside the drive's. */
  readonly conflicts: number;
}

export interface SketchSyncDependencies {
  readonly drive: ICloudDrive;
  readonly sketches: SketchLibrary;
}

/**
 * Keeps the sketches the same on every device, through one file on the drive.
 *
 * A sketch is changed far more often than a score, and on either device, so
 * "the newer one wins" would lose whatever the other device had done. So
 * each sketch carries a revision the drive counts, and a device remembers the
 * revision its copy was last in step with, and whether it has changed it
 * since - no device's clock is set against another's. Then:
 *
 * - A sketch only here goes to the drive; one only on the drive comes here:
 *   a sketch begun on one device is on the other at its next sync.
 * - Changed here, and still at the drive's revision: sent, a revision on.
 *   At an older revision and not changed here: the drive's is taken.
 * - Changed here *and* on the drive since: both kept. The drive's is taken
 *   under its own name, and this device's becomes a copy beside it, named
 *   so, and sent as a new sketch - the writer chooses which to keep.
 * - Deleted here: the drive is told, unless another device has changed it
 *   since, in which case it comes back. Deleted elsewhere: taken off here,
 *   unless changed here since, in which case it goes back to the drive.
 *
 * The sketch open in the editor is not taken from the drive underneath it -
 * its undo is of what is here - and waits for the next sync. What only the
 * drive's writing settles - sent, told - is marked here once it is written,
 * so a sync that fails partway is simply done again.
 */
export class SketchSync {
  private readonly deps: SketchSyncDependencies;

  constructor(dependencies: SketchSyncDependencies) {
    this.deps = dependencies;
  }

  /** One sync, leaving as it is the sketch open on the page (`open`), if any. */
  async sync(open: string | null): Promise<SketchSyncOutcome> {
    const { drive, sketches: library } = this.deps;
    await drive.connect();
    const file: CloudFile | undefined = (await drive.list()).find((each) => each.name === SKETCHES_FILE);
    const there = file === undefined ? { sketches: new Map(), deleted: new Map() } : readTheDrive(await drive.read(file.id));
    const { here, deleted: deletedHere } = library.forTheDrive();
    const editing = open;

    const next = new Map<string, SketchThere>(there.sketches);
    const nextDeleted = new Map<string, number>(there.deleted);
    // Settled here only once the drive has it.
    const sentAt: [string, number][] = [];
    const settled: string[] = [];
    let brought = 0;
    let takenOff = 0;
    let conflicts = 0;

    for (const { id, revision } of deletedHere) {
      const theirs = there.sketches.get(id);
      // Changed elsewhere since it was deleted here: it comes back, below.
      if (theirs !== undefined && theirs.revision <= revision) {
        next.delete(id);
        nextDeleted.set(id, theirs.revision);
      }
      settled.push(id);
    }
    const deletedHereIds = new Set(deletedHere.map(({ id }) => id));

    for (const mine of here) {
      const { sketch } = mine;
      const theirs = there.sketches.get(sketch.id);
      const gone = there.deleted.get(sketch.id);
      const send = (revision: number): void => {
        next.set(sketch.id, { sketch, revision });
        nextDeleted.delete(sketch.id);
        sentAt.push([sketch.id, revision]);
      };
      if (theirs === undefined) {
        if (gone !== undefined && !mine.unsent && mine.revision <= gone) {
          if (sketch.id !== editing) {
            library.deletedElsewhere(sketch.id);
            takenOff += 1;
          }
        } else {
          // New here; or changed here since another device deleted it.
          send(Math.max(mine.revision, gone ?? 0) + 1);
        }
      } else if (theirs.revision > mine.revision) {
        if (sketch.id === editing) {
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

    const hereIds = new Set(here.map(({ sketch }) => sketch.id));
    for (const theirs of there.sketches.values()) {
      if (!hereIds.has(theirs.sketch.id) && !deletedHereIds.has(theirs.sketch.id)) {
        library.takeFromTheDrive(theirs.sketch, theirs.revision);
        brought += 1;
      }
      // Deleted here but changed elsewhere since: brought back.
      if (deletedHereIds.has(theirs.sketch.id) && next.has(theirs.sketch.id)) {
        library.takeFromTheDrive(theirs.sketch, theirs.revision);
        brought += 1;
      }
    }

    const told = settled.filter((id) => there.sketches.has(id) && !next.has(id)).length;
    if (sentAt.length > 0 || told > 0) {
      await drive.write(SKETCHES_FILE, writeTheDrive(next, nextDeleted), file?.id ?? null);
    }
    for (const [id, revision] of sentAt) {
      library.sentAt(id, revision);
    }
    for (const id of settled) {
      library.deletionSettled(id);
    }
    return { sent: sentAt.length + told, brought, takenOff, conflicts };
  }
}

function writeTheDrive(sketches: ReadonlyMap<string, SketchThere>, deleted: ReadonlyMap<string, number>): string {
  return JSON.stringify({
    version: VERSION,
    sketches: [...sketches.values()].map(({ sketch, revision }) => ({ ...sketchAsKept(sketch), revision })),
    deleted: [...deleted],
  });
}

function isARevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * The drive's file, read as carefully as anything a program did not write
 * itself: an entry that does not hold together is left out rather than
 * trusted, and a file that is not one at all is an empty drive.
 */
function readTheDrive(text: string): TheDrivesSketches {
  const sketches = new Map<string, SketchThere>();
  const deleted = new Map<string, number>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { sketches, deleted };
  }
  const read = parsed as { sketches?: unknown; deleted?: unknown } | null;
  for (const entry of Array.isArray(read?.sketches) ? (read.sketches as unknown[]) : []) {
    const sketch = sketchFromKept(entry);
    const revision = (entry as { revision?: unknown } | null)?.revision;
    if (sketch !== null && isARevision(revision)) {
      sketches.set(sketch.id, { sketch, revision });
    }
  }
  for (const entry of Array.isArray(read?.deleted) ? (read.deleted as unknown[]) : []) {
    const [id, revision] = Array.isArray(entry) ? (entry as unknown[]) : [];
    if (typeof id === 'string' && isARevision(revision) && !sketches.has(id)) {
      deleted.set(id, revision);
    }
  }
  return { sketches, deleted };
}
