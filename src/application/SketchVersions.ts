import type { ISettingsStore } from './ports/ISettingsStore.js';
import { sketchAsKept, sketchFromKept, theSameSketch, type StoredSketch } from './SketchLibrary.js';

/** The most versions of one sketch kept: the oldest goes as another is kept. */
export const VERSIONS_OF_A_SKETCH = 20;

/**
 * The most room every version of every sketch takes, as it is written down.
 * The browser gives the page one allowance for everything it keeps, and the
 * sketches themselves are in it: versions that filled it would leave the
 * next change to a sketch nowhere to be kept. Past it, the oldest versions
 * of any sketch go first.
 */
export const ROOM_FOR_VERSIONS = 1_000_000;

const STORAGE_VERSION = 1;

/**
 * What a version was kept before: the sketch about to be edited, the
 * drive's copy about to be taken over it, or a version about to be put back
 * in its place.
 */
export type WhyAVersionWasKept = 'editing' | 'drive' | 'restoring';

const WHYS: readonly WhyAVersionWasKept[] = ['editing', 'drive', 'restoring'];

/** A sketch as it was, and when and why it was kept so. */
export interface SketchVersion {
  readonly keptAtMs: number;
  readonly why: WhyAVersionWasKept;
  readonly sketch: StoredSketch;
}

/**
 * Earlier versions of each sketch, on this device only.
 *
 * A version is kept each time something is about to take the sketch's place:
 * so whatever replaced it, what it was can be looked at and put back. Kept
 * apart from the sketches, so a change to one does not write every version
 * of every sketch again, and never sent to the drive: the drive's file is
 * read whole by every sync, and would grow with every change.
 */
export class SketchVersions {
  private readonly store: ISettingsStore;
  private readonly now: () => number;
  private readonly room: number;
  /** By sketch, newest first. */
  private versions = new Map<string, SketchVersion[]>();

  constructor(store: ISettingsStore, now: () => number, room = ROOM_FOR_VERSIONS) {
    this.store = store;
    this.now = now;
    this.room = room;
  }

  /** Reads what earlier visits kept. A version that does not hold together is left out. */
  load(): void {
    this.versions = new Map();
    const raw = this.store.read();
    const kept = isRecord(raw) && isRecord(raw['sketches']) ? raw['sketches'] : {};
    for (const [id, entries] of Object.entries(kept)) {
      const read = (Array.isArray(entries) ? entries : []).flatMap((entry): SketchVersion[] => {
        if (!isRecord(entry)) {
          return [];
        }
        const sketch = sketchFromKept(entry['sketch']);
        const { at, why } = entry;
        return sketch === null || typeof at !== 'number' || !WHYS.includes(why as WhyAVersionWasKept)
          ? []
          : [{ keptAtMs: at, why: why as WhyAVersionWasKept, sketch }];
      });
      this.versions.set(id, read);
    }
  }

  /** The versions kept of a sketch, newest first. */
  of(id: string): readonly SketchVersion[] {
    return this.versions.get(id) ?? [];
  }

  /**
   * Keeps a sketch as it is now, unless the version kept last is the same:
   * kept twice, it would be one version taking two places.
   */
  keep(sketch: StoredSketch, why: WhyAVersionWasKept): void {
    const before = this.of(sketch.id);
    const [newest] = before;
    if (newest !== undefined && theSameSketch(newest.sketch, sketch)) {
      return;
    }
    this.versions.set(sketch.id, [{ keptAtMs: this.now(), why, sketch }, ...before].slice(0, VERSIONS_OF_A_SKETCH));
    this.persist();
  }

  /** Lets every version of a sketch go: the sketch is gone from this device. */
  forget(id: string): void {
    if (this.versions.delete(id)) {
      this.persist();
    }
  }

  /** Writes the versions down, the oldest of any sketch let go of while they would take more than their room. */
  private persist(): void {
    for (let written = this.written(); written.length > this.room; written = this.written()) {
      if (!this.letTheOldestGo()) {
        break;
      }
    }
    this.store.write(JSON.parse(this.written()));
  }

  private written(): string {
    const sketches: Record<string, unknown> = {};
    for (const [id, versions] of this.versions) {
      sketches[id] = versions.map((version) => ({ at: version.keptAtMs, why: version.why, sketch: sketchAsKept(version.sketch) }));
    }
    return JSON.stringify({ version: STORAGE_VERSION, sketches });
  }

  /** Lets the oldest version of any sketch go; says whether there was one. */
  private letTheOldestGo(): boolean {
    let oldest: { readonly id: string; readonly atMs: number } | null = null;
    for (const [id, versions] of this.versions) {
      const last = versions[versions.length - 1];
      if (last !== undefined && (oldest === null || last.keptAtMs < oldest.atMs)) {
        oldest = { id, atMs: last.keptAtMs };
      }
    }
    if (oldest === null) {
      return false;
    }
    this.versions.set(oldest.id, (this.versions.get(oldest.id) ?? []).slice(0, -1));
    return true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
