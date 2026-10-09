import type { ISettingsStore } from '../ports/ISettingsStore.js';

const STORAGE_VERSION = 1;

/** Where a piece's section plan has got to, which is all it takes to pick it up again. */
export interface SavedDrill {
  /** Bars in a section, which with the piece itself gives the whole plan back. */
  readonly sectionBars: number;
  /** The step being asked for; the length of the plan once it has all been played. */
  readonly at: number;
  /** When the whole plan was last played through, on the calendar; `null` before it ever was. */
  readonly finishedAtMs: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readSaved(value: unknown): SavedDrill | null {
  if (!isRecord(value)) {
    return null;
  }
  const { sectionBars, at, finishedAtMs } = value;
  if (typeof sectionBars !== 'number' || !Number.isInteger(sectionBars) || sectionBars < 1) {
    return null;
  }
  if (typeof at !== 'number' || !Number.isInteger(at) || at < 0) {
    return null;
  }
  return {
    sectionBars,
    at,
    finishedAtMs: typeof finishedAtMs === 'number' && Number.isFinite(finishedAtMs) ? finishedAtMs : null,
  };
}

/**
 * Where each piece's section plan has got to, across visits.
 *
 * Only the place in it. The plan itself is worked out again from the piece -
 * its bars and its staves - and the size of a section, so nothing kept here
 * can come to disagree with the music it is a plan of; a piece read back
 * with fewer bars has its place cut back to the plan it now makes.
 */
export class DrillProgress {
  private readonly store: ISettingsStore;
  private pieces = new Map<string, SavedDrill>();

  constructor(store: ISettingsStore) {
    this.store = store;
  }

  /** Reads what earlier visits wrote, ignoring anything that no longer parses. */
  load(): void {
    this.pieces = new Map();
    const raw = this.store.read();
    if (!isRecord(raw) || !isRecord(raw['pieces'])) {
      return;
    }
    for (const [piece, value] of Object.entries(raw['pieces'])) {
      const saved = readSaved(value);
      if (saved !== null) {
        this.pieces.set(piece, saved);
      }
    }
  }

  /** Where this piece's plan has got to, or `null` where it has none. */
  of(piece: string): SavedDrill | null {
    return this.pieces.get(piece) ?? null;
  }

  keep(piece: string, saved: SavedDrill): void {
    this.pieces.set(piece, saved);
    this.flush();
  }

  forget(piece: string): void {
    if (this.pieces.delete(piece)) {
      this.flush();
    }
  }

  /** Carries a piece's plan over to the name it has been given. */
  rename(from: string, to: string): void {
    const saved = this.pieces.get(from);
    if (saved === undefined || from === to) {
      return;
    }
    this.pieces.delete(from);
    this.pieces.set(to, saved);
    this.flush();
  }

  private flush(): void {
    this.store.write({ version: STORAGE_VERSION, pieces: Object.fromEntries(this.pieces) });
  }
}
