import type { CloudFile, ICloudDrive } from './ports/ICloudDrive.js';
import { CLICK_PATTERNS, type ClickPattern } from './ports/IMetronome.js';
import type { IScoreStore, SavedPassage, StoredScore, StoredScoreSummary } from './ports/IScoreStore.js';

/** The list of what the drive holds, beside the documents themselves. */
const INDEX = 'library.json';
const VERSION = 1;

/** What the drive knows about one score, beside its document. */
export interface DriveScore {
  readonly id: string;
  readonly title: string;
  readonly bars: number;
  readonly savedAtMs: number;
  readonly openedAtMs: number;
  readonly markedAtMs: number;
  readonly passages: readonly SavedPassage[];
  readonly clickPattern?: ClickPattern;
  readonly stars?: number;
  /** The document's file on the drive, by name. */
  readonly file: string;
}

export interface SyncOutcome {
  /** Documents sent to the drive. */
  readonly sent: number;
  /** Scores this device took something from the drive for: a newer document, or newer marks. */
  readonly brought: number;
  /** Scores the drive has and this device does not, for the reader to bring here or leave. */
  readonly onlyOnTheDrive: readonly DriveScore[];
}

export interface LibrarySyncDependencies {
  readonly drive: ICloudDrive;
  readonly store: IScoreStore;
  /** Told when the store has changed underneath it, so the shelf shows it. */
  readonly reload: () => Promise<void>;
}

/**
 * Keeps the library the same on every device, through a folder on the drive.
 *
 * His reason: a hundred scores with a difficulty given to each, lost with a
 * device, would all have to be imported and judged again - and a new device
 * should be able to take them from the drive.
 *
 * Each score is settled on its own, by the newer word on each of its parts:
 * the document by when it was kept (a re-imported file is the newer one), the
 * marks - stars, click, passages - by when the reader last said something
 * about them, and when it was last opened by whichever device opened it last.
 * A score only the drive has is not brought here unasked: a library is what
 * the reader chose to keep on this device, and the list says what else there
 * is. Taking a score off one device does not take it off the drive.
 */
export class LibrarySync {
  private readonly deps: LibrarySyncDependencies;
  /** The folder as last listed, so a score can be brought here without asking again. */
  private files: readonly CloudFile[] = [];

  constructor(dependencies: LibrarySyncDependencies) {
    this.deps = dependencies;
  }

  async sync(progress?: (done: number, total: number) => void): Promise<SyncOutcome> {
    const { drive, store } = this.deps;
    await drive.connect();
    this.files = await drive.list();
    const named = new Map(this.files.map((file) => [file.name, file]));
    const index = named.get(INDEX);
    const there = index === undefined ? new Map<string, DriveScore>() : readIndex(await drive.read(index.id));
    const here = await store.list();
    const settled = new Map(there);
    let sent = 0;
    let brought = 0;

    for (const [done, mine] of here.entries()) {
      const theirs = there.get(mine.id);
      const documentIsTheirs = theirs !== undefined && theirs.savedAtMs > mine.savedAtMs;
      const marksAreTheirs = theirs !== undefined && theirs.markedAtMs > markedAt(mine);
      const document = documentIsTheirs ? theirs : mine;
      const marks = marksAreTheirs ? theirs : mine;
      const file = theirs?.file ?? documentName(mine.title);
      const agreed: DriveScore = {
        id: mine.id,
        title: document.title,
        bars: document.bars,
        savedAtMs: document.savedAtMs,
        openedAtMs: Math.max(mine.openedAtMs, theirs?.openedAtMs ?? 0),
        markedAtMs: Math.max(markedAt(mine), theirs?.markedAtMs ?? 0),
        passages: marks.passages,
        ...(marks.clickPattern === undefined ? {} : { clickPattern: marks.clickPattern }),
        ...(marks.stars === undefined ? {} : { stars: marks.stars }),
        file,
      };

      if (theirs === undefined || mine.savedAtMs > theirs.savedAtMs) {
        const kept = await store.read(mine.id);
        if (kept !== null) {
          await drive.write(file, kept.musicXml, named.get(file)?.id ?? null);
          sent += 1;
        }
      }
      const takesFromTheDrive =
        documentIsTheirs || marksAreTheirs || agreed.openedAtMs !== mine.openedAtMs;
      if (takesFromTheDrive) {
        const musicXml = documentIsTheirs
          ? await this.readDocument(theirs.file)
          : ((await store.read(mine.id))?.musicXml ?? null);
        if (musicXml !== null) {
          await store.write(storedFrom(agreed, musicXml));
          if (documentIsTheirs || marksAreTheirs) {
            brought += 1;
          }
        }
      }
      settled.set(mine.id, agreed);
      progress?.(done + 1, here.length);
    }

    await drive.write(INDEX, writeIndex(settled), index?.id ?? null);
    this.files = await drive.list();
    await this.deps.reload();
    const kept = new Set(here.map((score) => score.id));
    return {
      sent,
      brought,
      onlyOnTheDrive: [...there.values()]
        .filter((score) => !kept.has(score.id))
        .sort((left, right) => left.title.localeCompare(right.title)),
    };
  }

  /** Takes a score the drive has onto this device, with everything said about it. */
  async bringHere(score: DriveScore): Promise<void> {
    await this.deps.drive.connect();
    const musicXml = await this.readDocument(score.file);
    if (musicXml === null) {
      throw new Error(`"${score.title}" is no longer on the drive.`);
    }
    await this.deps.store.write(storedFrom(score, musicXml));
    await this.deps.reload();
  }

  private async readDocument(name: string): Promise<string | null> {
    let file = this.files.find((each) => each.name === name);
    if (file === undefined) {
      this.files = await this.deps.drive.list();
      file = this.files.find((each) => each.name === name);
    }
    return file === undefined ? null : this.deps.drive.read(file.id);
  }
}

/**
 * When the reader last said something about a score, for settling it.
 *
 * A score marked before the moment was kept has marks and no moment. A piece
 * can only be judged once it is kept, so its marks are no older than that,
 * and that is the moment taken for them. A device that has said nothing at
 * all about it has nothing that could win.
 */
function markedAt(score: StoredScoreSummary): number {
  if (score.markedAtMs !== undefined) {
    return score.markedAtMs;
  }
  const marked =
    score.stars !== undefined || score.clickPattern !== undefined || score.passages.length > 0;
  return marked ? score.savedAtMs : 0;
}

/** A document's name on the drive: the title, which is what the reader will look for there. */
function documentName(title: string): string {
  return `${title.replace(/[\\/]/g, '-')}.musicxml`;
}

function storedFrom(score: DriveScore, musicXml: string): StoredScore {
  const { file: _file, ...summary } = score;
  return { ...summary, musicXml };
}

function writeIndex(scores: ReadonlyMap<string, DriveScore>): string {
  return JSON.stringify({ version: VERSION, scores: [...scores.values()] });
}

/**
 * The drive's list, read as carefully as anything a program did not write
 * itself: an entry that does not hold together is left out rather than
 * trusted, and a list that is not one at all is an empty drive.
 */
function readIndex(text: string): Map<string, DriveScore> {
  const read = new Map<string, DriveScore>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return read;
  }
  const scores = (parsed as { scores?: unknown } | null)?.scores;
  if (!Array.isArray(scores)) {
    return read;
  }
  for (const entry of scores as unknown[]) {
    const score = entry as Partial<Record<keyof DriveScore, unknown>> | null;
    if (
      score === null ||
      typeof score.id !== 'string' ||
      typeof score.title !== 'string' ||
      typeof score.file !== 'string' ||
      typeof score.bars !== 'number' ||
      typeof score.savedAtMs !== 'number' ||
      typeof score.openedAtMs !== 'number' ||
      typeof score.markedAtMs !== 'number' ||
      !Array.isArray(score.passages)
    ) {
      continue;
    }
    const click = CLICK_PATTERNS.find((pattern) => pattern === score.clickPattern);
    read.set(score.id, {
      id: score.id,
      title: score.title,
      file: score.file,
      bars: score.bars,
      savedAtMs: score.savedAtMs,
      openedAtMs: score.openedAtMs,
      markedAtMs: score.markedAtMs,
      passages: (score.passages as unknown[]).filter(isPassage),
      ...(click === undefined ? {} : { clickPattern: click }),
      ...(typeof score.stars === 'number' ? { stars: score.stars } : {}),
    });
  }
  return read;
}

function isPassage(value: unknown): value is SavedPassage {
  const passage = value as Partial<Record<keyof SavedPassage, unknown>> | null;
  return (
    passage !== null &&
    typeof passage.name === 'string' &&
    typeof passage.fromBar === 'number' &&
    typeof passage.toBar === 'number'
  );
}
