import { describe, expect, it } from 'vitest';
import { DriveSync } from '../../src/application/DriveSync.js';
import { LibrarySync } from '../../src/application/LibrarySync.js';
import type { CloudFile, ICloudDrive } from '../../src/application/ports/ICloudDrive.js';
import { InMemoryScoreStore, type StoredScore } from '../../src/application/ports/IScoreStore.js';
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';
import { SettingsRepository } from '../../src/application/SettingsRepository.js';
import { SettingsSync } from '../../src/application/SettingsSync.js';
import { SketchLibrary } from '../../src/application/SketchLibrary.js';
import { SKETCHES_FILE, SketchSync } from '../../src/application/SketchSync.js';
import type { SyncProgressShown } from '../../src/application/SyncProgress.js';
import type { MidiFileEvent } from '../../src/domain/midi/MidiFile.js';

const KNOWN = { presetIds: [], modeIds: [], rhythmProfileIds: [] };

/**
 * A drive folder as a map of names to contents, counting the requests made
 * of it - and, where a test says so, doing something of its own just before
 * it answers one, as another device writing it meanwhile does.
 */
class FolderDrive implements ICloudDrive {
  readonly signedIn = true;
  readonly files = new Map<string, { id: string; content: string }>();
  requests = 0;
  beforeAnswering: ((request: number) => void) | null = null;
  private made = 0;

  prepare(): void {}

  connect(): Promise<void> {
    return Promise.resolve();
  }

  list(): Promise<readonly CloudFile[]> {
    this.asked();
    return Promise.resolve([...this.files].map(([name, file]) => ({ id: file.id, name })));
  }

  read(id: string): Promise<string> {
    this.asked();
    const found = [...this.files.values()].find((file) => file.id === id);
    return found === undefined ? Promise.reject(new Error('gone')) : Promise.resolve(found.content);
  }

  trash(id: string): Promise<void> {
    this.asked();
    for (const [name, file] of this.files) {
      if (file.id === id) {
        this.files.delete(name);
      }
    }
    return Promise.resolve();
  }

  write(name: string, content: string, replacing: string | null): Promise<CloudFile> {
    this.asked();
    const id = replacing ?? `file-${String((this.made += 1))}`;
    this.files.set(name, { id, content });
    return Promise.resolve({ id, name });
  }

  private asked(): void {
    this.requests += 1;
    this.beforeAnswering?.(this.requests);
  }
}

function score(title: string, fields: Partial<StoredScore> = {}): StoredScore {
  return {
    id: `score:${title}`,
    title,
    savedAtMs: 1_000,
    openedAtMs: 1_000,
    bars: 8,
    passages: [],
    musicXml: `<score>${title}</score>`,
    ...fields,
  };
}

const PLAYED: readonly MidiFileEvent[] = [
  { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.7 },
  { kind: 'noteOff', atMs: 300, midi: 60 },
];

/** A device sharing the drive: its scores, settings and sketches, and one sync of them all. */
async function device(drive: FolderDrive, scores: StoredScore[] = []) {
  const store = new InMemoryScoreStore();
  for (const each of scores) {
    await store.write(each);
  }
  const repository = new SettingsRepository(new InMemorySettingsStore(), KNOWN);
  repository.load();
  const sketches = new SketchLibrary(new InMemorySettingsStore(), () => 1_000);
  const sync = new DriveSync({
    library: new LibrarySync({ drive, store, reload: () => Promise.resolve() }),
    settings: new SettingsSync({ drive, settings: repository, apply: () => undefined }),
    sketches: new SketchSync({ drive, sketches }),
    sketchesUnsentSinceMs: () => sketches.unsentSinceMs,
    scores: () => [],
    repository,
    now: () => 50_000,
  });
  return {
    store,
    repository,
    sketches,
    /** Syncs, and gives back every word of how far it had got, beside the requests the drive had by then. */
    async sync(): Promise<{ shown: SyncProgressShown; requests: number }[]> {
      const told: { shown: SyncProgressShown; requests: number }[] = [];
      const before = drive.requests;
      await sync.sync((shown) => told.push({ shown, requests: drive.requests - before }));
      return told;
    },
  };
}

/**
 * What every sync must hold to: each request counted as it is answered, no
 * measure before the drive has said what it holds, then a share that only
 * grows - and that ends at the whole, the requests expected being exactly
 * those made.
 */
function expectHonest(
  told: readonly { shown: SyncProgressShown; requests: number }[],
  requests: number,
  { growing = true } = {},
): void {
  for (const { shown, requests: madeByThen } of told) {
    expect(shown.answered).toBe(madeByThen);
  }
  const measured = told.findIndex(({ shown }) => shown.expected !== null);
  expect(measured).toBeGreaterThan(0);
  expect(told.slice(measured).every(({ shown }) => shown.expected !== null)).toBe(true);
  const shares = told.slice(measured).map(({ shown }) => shown.answered / (shown.expected ?? 1));
  if (growing) {
    for (const [at, share] of shares.entries()) {
      expect(share).toBeGreaterThanOrEqual(shares[at - 1] ?? 0);
    }
  }
  expect(told.at(-1)?.shown).toEqual({ answered: requests, expected: requests });
}

describe('how far a sync has got, in requests to the drive', () => {
  it('measures a first sync sending everything, a second device bringing it, and one with nothing to do', async () => {
    const drive = new FolderDrive();
    const pc = await device(drive, [score('Clair de Lune'), score('Gymnopédie')]);
    pc.repository.adoptSettings({ values: { ...pc.repository.sharedSettings().values, tempoPercent: 70 }, changedAtMs: 5_000 });
    pc.sketches.begin({ events: PLAYED, beats: [] }, 'Idea', 1);

    // Into an empty folder: listed, two scores and the list written, listed
    // again; the settings listed and written; the sketches listed, listed
    // again just before they are written, and written. Nothing to read.
    let before = drive.requests;
    let told = await pc.sync();
    expect(drive.requests - before).toBe(10);
    expectHonest(told, 10);

    // A second device holding an older copy of one score: its document brought.
    const ipad = await device(drive, [score('Clair de Lune', { savedAtMs: 500 })]);
    before = drive.requests;
    told = await ipad.sync();
    expect((await ipad.store.read('score:Clair de Lune'))?.savedAtMs).toBe(1_000);
    expectHonest(told, drive.requests - before);

    // Nothing changed anywhere: only what is read.
    before = drive.requests;
    told = await pc.sync();
    expectHonest(told, drive.requests - before);
    expect(drive.requests - before).toBe(8);
  });

  it('measures a document the list names and the folder no longer holds', async () => {
    const drive = new FolderDrive();
    const pc = await device(drive, [score('Clair de Lune', { savedAtMs: 2_000 })]);
    await pc.sync();
    drive.files.delete('Clair de Lune.musicxml');
    const ipad = await device(drive, [score('Clair de Lune')]);

    const before = drive.requests;
    const told = await ipad.sync();

    // Listed once more to look for it, which steps the share back, and nothing to read.
    expectHonest(told, drive.requests - before, { growing: false });
    expect((await ipad.store.read('score:Clair de Lune'))?.savedAtMs).toBe(1_000);
  });

  it('measures a score this device lists and can no longer read', async () => {
    const drive = new FolderDrive();
    const pc = await device(drive, [score('Clair de Lune'), score('Gymnopédie')]);
    const read = pc.store.read.bind(pc.store);
    pc.store.read = (id) => (id === 'score:Gymnopédie' ? Promise.resolve(null) : read(id));

    const before = drive.requests;
    const told = await pc.sync();

    // Its document not sent, and not waited for.
    expect(drive.files.has('Gymnopédie.musicxml')).toBe(false);
    expectHonest(told, drive.requests - before);
  });

  it('measures a sync of the sketches settled again where another device wrote them meanwhile', async () => {
    const drive = new FolderDrive();
    const pc = await device(drive);
    pc.sketches.begin({ events: PLAYED, beats: [] }, 'Idea', 1);
    let written = false;
    drive.beforeAnswering = () => {
      // The sketches read the first time, another device writes them before they are read again.
      const file = drive.files.get(SKETCHES_FILE);
      if (!written && file === undefined && drive.requests > 6) {
        written = true;
        drive.files.set(SKETCHES_FILE, { id: 'elsewhere', content: '{"version":1,"sketches":[]}' });
      }
    };

    const before = drive.requests;
    const told = await pc.sync();

    // Settled again, as much again may be asked: the one time the share steps back.
    expect(written).toBe(true);
    expectHonest(told, drive.requests - before, { growing: false });
  });
});
