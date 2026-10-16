import { describe, expect, it } from 'vitest';
import type { CloudFile, ICloudDrive } from '../../src/application/ports/ICloudDrive.js';
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';
import { SketchLibrary } from '../../src/application/SketchLibrary.js';
import { CONFLICTING_COPY, SKETCHES_FILE, SketchSync } from '../../src/application/SketchSync.js';
import type { HeardBeat, MidiFileEvent } from '../../src/domain/midi/MidiFile.js';

/** A folder on the drive, shared by the devices of a test; a write can be made to fail. */
class FolderDrive implements ICloudDrive {
  readonly signedIn = true;
  readonly files = new Map<string, { id: string; content: string }>();
  writes = 0;
  failing = false;
  private made = 0;

  prepare(): void {}

  connect(): Promise<void> {
    return Promise.resolve();
  }

  list(): Promise<readonly CloudFile[]> {
    return Promise.resolve([...this.files].map(([name, file]) => ({ id: file.id, name })));
  }

  read(id: string): Promise<string> {
    const found = [...this.files.values()].find((file) => file.id === id);
    return found === undefined ? Promise.reject(new Error('gone')) : Promise.resolve(found.content);
  }

  write(name: string, content: string, replacing: string | null): Promise<CloudFile> {
    if (this.failing) {
      return Promise.reject(new Error('The drive could not be reached.'));
    }
    this.writes += 1;
    const id = replacing ?? `file-${String((this.made += 1))}`;
    this.files.set(name, { id, content });
    return Promise.resolve({ id, name });
  }

  /** What the drive holds, read plainly: each sketch's id, title and revision. */
  holds(): [string, string, number][] {
    const read = JSON.parse(this.files.get(SKETCHES_FILE)?.content ?? '{"sketches":[]}') as {
      sketches: { id: string; title: string; revision: number }[];
    };
    return read.sketches.map(({ id, title, revision }) => [id, title, revision] as [string, string, number]).sort();
  }
}

const on = (atMs: number, midi: number): MidiFileEvent => ({ kind: 'noteOn', atMs, midi, velocity: 89 / 127 });
const off = (atMs: number, midi: number): MidiFileEvent => ({ kind: 'noteOff', atMs, midi });
const PLAYED: readonly MidiFileEvent[] = [on(0, 60), off(300, 60), on(500, 64), off(800, 64)];
const BEATS: readonly HeardBeat[] = [
  { atMs: 0, beat: 0, beatsInBar: 4 },
  { atMs: 500, beat: 1, beatsInBar: 4 },
];

/** A device: its sketches, its sync to the shared drive, and which sketch it has open. */
function device(drive: FolderDrive) {
  let open: string | null = null;
  const sketches = new SketchLibrary(new InMemorySettingsStore(), () => 1_000);
  const sync = new SketchSync({ drive, sketches });
  return {
    sketches,
    sync: () => sync.sync(open),
    bring: (id: string) => sync.bringHere(id),
    edit: (id: string | null) => {
      open = id;
    },
    titles: () => sketches.list().map((sketch) => sketch.title).sort(),
  };
}

describe('the sketches kept the same on every device that has them', () => {
  it('offers one begun on another device rather than bringing it, and keeps it in step once brought', async () => {
    const drive = new FolderDrive();
    const ipad = device(drive);
    const pc = device(drive);
    const older = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Older', 1);
    const idea = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Idea', 2);

    expect(await ipad.sync()).toEqual({ sent: 2, brought: 0, conflicts: 0, onlyOnTheDrive: [] });
    const written = drive.files.get(SKETCHES_FILE)?.id;
    // Offered, newest first, and not brought.
    expect(await pc.sync()).toEqual({
      sent: 0,
      brought: 0,
      conflicts: 0,
      onlyOnTheDrive: [
        { id: idea.id, title: 'Idea', begunAtMs: 2, noteCount: 2 },
        { id: older.id, title: 'Older', begunAtMs: 1, noteCount: 2 },
      ],
    });
    expect(pc.titles()).toEqual([]);

    await pc.bring(idea.id);
    expect(pc.sketches.find(idea.id)?.events).toEqual(idea.events);
    expect(pc.sketches.find(idea.id)?.beats).toEqual(idea.beats);
    expect(pc.sketches.unsentSinceMs).toBeNull();
    // In step on both: nothing to send, and the drive not written again.
    const writes = drive.writes;
    expect((await pc.sync()).onlyOnTheDrive.map(({ title }) => title)).toEqual(['Older']);
    expect((await ipad.sync()).sent).toBe(0);
    expect(drive.writes).toBe(writes);
    // Written again, it is the same file, not another beside it.
    pc.sketches.rename(idea.id, 'Again');
    await pc.sync();
    expect(drive.files.get(SKETCHES_FILE)?.id).toBe(written);
  });

  it('takes a change made on one device to the other that has it, a revision on', async () => {
    const drive = new FolderDrive();
    const ipad = device(drive);
    const pc = device(drive);
    const idea = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Idea', 1);
    await ipad.sync();
    await pc.bring(idea.id);

    pc.sketches.changeTheNotes(idea.id, PLAYED.slice(0, 2));
    pc.sketches.rename(idea.id, 'Better');
    expect((await pc.sync()).sent).toBe(1);
    expect((await ipad.sync()).brought).toBe(1);

    expect(ipad.sketches.find(idea.id)?.title).toBe('Better');
    expect(ipad.sketches.find(idea.id)?.noteCount).toBe(1);
    expect(drive.holds()).toEqual([[idea.id, 'Better', 2]]);
  });

  it('keeps both where one was changed on each device: the drive\'s under its name, this one\'s as a copy beside it', async () => {
    const drive = new FolderDrive();
    const ipad = device(drive);
    const pc = device(drive);
    const idea = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Idea', 1);
    await ipad.sync();
    await pc.bring(idea.id);

    pc.sketches.changeTheNotes(idea.id, PLAYED.slice(0, 2));
    ipad.sketches.changeTheNotes(idea.id, [...PLAYED, on(900, 67), off(1_000, 67)]);
    await pc.sync();
    const synced = await ipad.sync();
    expect([synced.sent, synced.brought, synced.conflicts]).toEqual([1, 1, 1]);

    // The drive's notes under the name; the iPad's in the copy.
    expect(ipad.sketches.find(idea.id)?.noteCount).toBe(1);
    const copy = ipad.sketches.find(`${idea.id}-copy`);
    expect([copy?.title, copy?.noteCount]).toEqual([`Idea (${CONFLICTING_COPY})`, 3]);
    expect(ipad.sketches.unsentSinceMs).toBeNull();
    // And the copy offered to the PC.
    expect((await pc.sync()).onlyOnTheDrive.map(({ title }) => title)).toEqual([`Idea (${CONFLICTING_COPY})`]);
  });

  it('takes one deleted here off this device only, and offers it back', async () => {
    const drive = new FolderDrive();
    const ipad = device(drive);
    const pc = device(drive);
    const idea = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Idea', 1);
    await ipad.sync();
    await pc.bring(idea.id);

    ipad.sketches.remove(idea.id);
    const synced = await ipad.sync();
    expect([synced.sent, synced.onlyOnTheDrive.map(({ title }) => title)]).toEqual([0, ['Idea']]);
    expect(drive.holds()).toEqual([[idea.id, 'Idea', 1]]);
    expect(pc.titles()).toEqual(['Idea']);
    expect((await pc.sync()).onlyOnTheDrive).toEqual([]);

    await ipad.bring(idea.id);
    expect(ipad.titles()).toEqual(['Idea']);
    await expect(ipad.bring('nowhere')).rejects.toThrow('no longer on the drive');
  });

  it('leaves the sketch open in the editor as it is, and settles it at the sync after', async () => {
    const drive = new FolderDrive();
    const ipad = device(drive);
    const pc = device(drive);
    const idea = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Idea', 1);
    await ipad.sync();
    await pc.bring(idea.id);

    pc.sketches.rename(idea.id, 'Renamed on the PC');
    await pc.sync();
    ipad.edit(idea.id);
    expect((await ipad.sync()).brought).toBe(0);
    expect(ipad.titles()).toEqual(['Idea']);

    ipad.edit(null);
    expect((await ipad.sync()).brought).toBe(1);
    expect(ipad.titles()).toEqual(['Renamed on the PC']);
  });

  it('sends one the drive has at an older revision than here, a revision past both', async () => {
    const drive = new FolderDrive();
    const ipad = device(drive);
    const idea = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Idea', 1);
    await ipad.sync();
    ipad.sketches.rename(idea.id, 'Twice');
    await ipad.sync();
    ipad.sketches.rename(idea.id, 'Thrice');
    await ipad.sync();
    expect(drive.holds()).toEqual([[idea.id, 'Thrice', 3]]);
    // The drive put back to an older file of it, at revision 1.
    const file = drive.files.get(SKETCHES_FILE);
    drive.files.set(SKETCHES_FILE, {
      id: file?.id ?? '',
      content: (file?.content ?? '').replace('"revision":3', '"revision":1'),
    });

    expect((await ipad.sync()).sent).toBe(1);
    expect(drive.holds()).toEqual([[idea.id, 'Thrice', 4]]);
  });

  it('marks nothing sent where the drive could not be written, and sends it at the next sync', async () => {
    const drive = new FolderDrive();
    const ipad = device(drive);
    const idea = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Idea', 1);
    await ipad.sync();
    ipad.sketches.rename(idea.id, 'Renamed');

    drive.failing = true;
    await expect(ipad.sync()).rejects.toThrow('could not be reached');
    expect(ipad.sketches.forTheDrive().map(({ unsent }) => unsent)).toEqual([true]);

    drive.failing = false;
    expect((await ipad.sync()).sent).toBe(1);
    expect(drive.holds()).toEqual([[idea.id, 'Renamed', 2]]);
  });

  it('reads past what on the drive it cannot, and a file that is no list at all as an empty drive', async () => {
    const drive = new FolderDrive();
    const pc = device(drive);
    const good = { id: 'good', title: 'Good', begunAtMs: 1, events: [], beats: [], key: [0, 0] };
    drive.files.set(SKETCHES_FILE, {
      id: 'file-9',
      content: JSON.stringify({
        version: 1,
        sketches: [
          { ...good, revision: 2 },
          { ...good, id: 'no-revision' },
          { ...good, id: 'half', revision: 1.5 },
          { ...good, id: 'nought', revision: 0 },
          { id: 'broken', revision: 1 },
          null,
        ],
      }),
    });
    expect((await pc.sync()).onlyOnTheDrive.map(({ id }) => id)).toEqual(['good']);
    // Written back without what it could not read.
    pc.sketches.begin({ events: PLAYED, beats: BEATS }, 'Mine', 3);
    await pc.sync();
    expect(drive.holds().map(([, title]) => title)).toEqual(['Good', 'Mine']);

    const other = new FolderDrive();
    other.files.set(SKETCHES_FILE, { id: 'file-1', content: 'not json' });
    const fresh = device(other);
    fresh.sketches.begin({ events: PLAYED, beats: BEATS }, 'Mine', 1);
    expect((await fresh.sync()).sent).toBe(1);
    expect(other.holds().map(([, title]) => title)).toEqual(['Mine']);
  });
});
