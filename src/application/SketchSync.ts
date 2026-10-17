import type { CloudFile, ICloudDrive } from './ports/ICloudDrive.js';
import { sameKeys, theChordsMerged } from '../domain/harmony/chordsOfTheKey.js';
import { readTheChords, sketchAsKept, sketchFromKept, type SketchLibrary, type StoredSketch } from './SketchLibrary.js';
import type { SyncProgress } from './SyncProgress.js';

/** The one file on the drive that holds every sketch. */
export const SKETCHES_FILE = 'sketches.json';
const VERSION = 1;

/** How many times a sync is settled again where another device wrote the drive meanwhile. */
const SETTLED_AT_MOST = 3;

/** The requests reading the drive's sketches takes: the folder listed, and the file read. */
const REQUESTS_TO_READ = 2;

/**
 * The most one settling of the sketches asks the drive: read, read again
 * just before writing, and written.
 */
export const SKETCH_REQUESTS_AT_MOST = 2 * REQUESTS_TO_READ + 1;

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
 *
 * The chords kept in the palette go in the same file, as one list for every
 * sketch. A chord has nothing in it to change, only to be kept or let go of,
 * so the lists are merged rather than one taken: whatever was kept or let go
 * of here since the last sync is done to the drive's list, and nothing is
 * ever a conflict (see `theChordsMerged`).
 */
export class SketchSync {
  private readonly deps: SketchSyncDependencies;

  constructor(dependencies: SketchSyncDependencies) {
    this.deps = dependencies;
  }

  /**
   * One sync, leaving as it is the sketch open on the page (`open`), if any.
   *
   * Two devices syncing at once each read the drive before the other wrote
   * it, each sent its own change at the same revision, and the second write
   * took the first's place: both then counted themselves in step, with
   * different notes, for ever. So the drive is read again just before it is
   * written, and where another device has written it since, the sync is
   * settled again from what is there now - a few times, and then written
   * anyway: what still slips through is a sketch at the drive's revision
   * with other notes than the drive's, which the next sync keeps as a copy
   * (see `settle`).
   */
  async sync(open: string | null, progress?: SyncProgress): Promise<SketchSyncOutcome> {
    const drive = progress === undefined ? this.deps.drive : progress.counting(this.deps.drive);
    let brought = 0;
    let conflicts = 0;
    for (let attempt = 1; ; attempt += 1) {
      // Settled again, after the first time: as much again may be asked.
      if (attempt > 1) {
        progress?.expect(SKETCH_REQUESTS_AT_MOST);
      }
      const read = await this.readTheDrive(drive, progress);
      const round = this.settle(read.there, open);
      brought += round.brought;
      conflicts += round.conflicts;
      const { kept, inStep } = this.deps.sketches.chordsForTheDrive();
      const chords = theChordsMerged(read.chords, kept, inStep);
      const chordsToSend = read.chords === null ? chords.length > 0 : !theSameChords(chords, read.chords);
      if (round.sentAt.length > 0 || chordsToSend) {
        const again = await this.readTheDrive(drive, progress);
        if (again.text !== read.text && attempt < SETTLED_AT_MOST) {
          // Not written this time round, but settled again.
          progress?.spare(1);
          continue;
        }
        await drive.write(SKETCHES_FILE, writeTheDrive(round.next, chords), again.file?.id ?? null);
      } else {
        progress?.spare(REQUESTS_TO_READ + 1);
      }
      for (const [id, revision] of round.sentAt) {
        this.deps.sketches.sentAt(id, revision);
      }
      this.deps.sketches.chordsSettled(chords, kept);
      return {
        sent: round.sentAt.length,
        brought,
        conflicts,
        onlyOnTheDrive: onlyOnTheDrive(round.next, this.deps.sketches),
      };
    }
  }

  /**
   * Settles each sketch here against the drive's: what the drive is to hold,
   * and which sketches go to it at which revision - marked sent only once it
   * has them. Taking the drive's, and keeping a copy, are done here at once:
   * they are this device catching up, whatever is written after.
   *
   * A sketch at the drive's revision, unchanged here since, whose notes are
   * not the drive's has been written over by another device at that same
   * revision; it is kept as a copy, as a change made on both is.
   */
  private settle(
    there: ReadonlyMap<string, SketchThere>,
    open: string | null,
  ): { readonly next: Map<string, SketchThere>; readonly sentAt: [string, number][]; readonly brought: number; readonly conflicts: number } {
    const library = this.deps.sketches;
    const next = new Map<string, SketchThere>(there);
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
        continue;
      }
      const writtenOver = theirs.revision === mine.revision && !mine.unsent && !theSame(theirs.sketch, sketch);
      if (theirs.revision > mine.revision || writtenOver) {
        if (sketch.id === open) {
          continue;
        }
        if (mine.unsent || writtenOver) {
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
    return { next, sentAt, brought, conflicts };
  }

  /** Takes a sketch the drive has onto this device, as the drive has it now. */
  async bringHere(id: string): Promise<void> {
    const theirs = (await this.readTheDrive(this.deps.drive)).there.get(id);
    if (theirs === undefined) {
      throw new Error('That sketch is no longer on the drive.');
    }
    this.deps.sketches.takeFromTheDrive(theirs.sketch, theirs.revision);
  }

  /**
   * Takes a sketch off the drive, where no device here has it: the one place
   * an unwanted copy or an old sketch can be cleared from, since deleting one
   * on a device leaves the drive's. A device that still has it sends it back
   * at its next sync, as it would any sketch the drive lacks.
   *
   * Read again just before it is written, as a sync is, so a sketch another
   * device sent meanwhile is not written over: settled again from what is
   * there now, a few times, and then written anyway.
   */
  async deleteFromTheDrive(id: string): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      const read = await this.readTheDrive(this.deps.drive);
      if (!read.there.has(id)) {
        return;
      }
      const next = new Map(read.there);
      next.delete(id);
      const again = await this.readTheDrive(this.deps.drive);
      if (again.text !== read.text && attempt < SETTLED_AT_MOST) {
        continue;
      }
      await this.deps.drive.write(SKETCHES_FILE, writeTheDrive(next, again.chords), again.file?.id ?? null);
      return;
    }
  }

  /** The drive's sketches, as `drive` reads them: where the file is not there yet, `progress` is spared reading it. */
  private async readTheDrive(
    drive: ICloudDrive,
    progress?: SyncProgress,
  ): Promise<{
    readonly file: CloudFile | undefined;
    readonly text: string | null;
    readonly there: ReadonlyMap<string, SketchThere>;
    readonly chords: readonly (readonly number[])[] | null;
  }> {
    await drive.connect();
    const file = (await drive.list()).find((each) => each.name === SKETCHES_FILE);
    if (file === undefined) {
      progress?.spare(1);
    }
    const text = file === undefined ? null : await drive.read(file.id);
    return { file, text, ...(text === null ? { there: new Map(), chords: null } : readTheDrive(text)) };
  }
}

/** Whether two sketches say the same thing, as they are kept. */
function theSame(one: StoredSketch, other: StoredSketch): boolean {
  return JSON.stringify(sketchAsKept(one)) === JSON.stringify(sketchAsKept(other));
}

/** What the drive has that the library here does not, newest first. */
function onlyOnTheDrive(there: ReadonlyMap<string, SketchThere>, library: SketchLibrary): readonly SketchOnTheDrive[] {
  return [...there.values()]
    .filter(({ sketch }) => library.find(sketch.id) === null)
    .map(({ sketch }) => ({ id: sketch.id, title: sketch.title, begunAtMs: sketch.begunAtMs, noteCount: sketch.noteCount }))
    .sort((one, other) => other.begunAtMs - one.begunAtMs);
}

/** Whether two lists of chords are the same chords in the same order. */
function theSameChords(one: readonly (readonly number[])[], other: readonly (readonly number[])[]): boolean {
  return one.length === other.length && one.every((chord, at) => sameKeys(chord, other[at] ?? []));
}

function writeTheDrive(sketches: ReadonlyMap<string, SketchThere>, chords: readonly (readonly number[])[] | null): string {
  return JSON.stringify({
    version: VERSION,
    sketches: [...sketches.values()].map(({ sketch, revision }) => ({ ...sketchAsKept(sketch), revision })),
    ...(chords === null ? {} : { chords }),
  });
}

/**
 * The drive's file, read as carefully as anything a program did not write
 * itself: an entry that does not hold together is left out rather than
 * trusted, and a file that is not one at all is an empty drive.
 */
function readTheDrive(text: string): {
  readonly there: ReadonlyMap<string, SketchThere>;
  readonly chords: readonly (readonly number[])[] | null;
} {
  const sketches = new Map<string, SketchThere>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { there: sketches, chords: null };
  }
  const read = parsed as { sketches?: unknown; chords?: unknown } | null;
  for (const entry of Array.isArray(read?.sketches) ? (read.sketches as unknown[]) : []) {
    const sketch = sketchFromKept(entry);
    const revision = (entry as { revision?: unknown } | null)?.revision;
    if (sketch !== null && typeof revision === 'number' && Number.isInteger(revision) && revision > 0) {
      sketches.set(sketch.id, { sketch, revision });
    }
  }
  return { there: sketches, chords: readTheChords(read?.chords) };
}
