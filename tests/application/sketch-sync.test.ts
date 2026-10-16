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

  /** What the drive holds, read plainly: each sketch's title and revision, and what was deleted. */
  holds(): { sketches: [string, string, number][]; deleted: [string, number][] } {
    const read = JSON.parse(this.files.get(SKETCHES_FILE)?.content ?? '{"sketches":[],"deleted":[]}') as {
      sketches: { id: string; title: string; revision: number }[];
      deleted: [string, number][];
    };
    return {
      sketches: read.sketches.map(({ id, title, revision }) => [id, title, revision] as [string, string, number]).sort(),
      deleted: [...read.deleted].sort(),
    };
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
    edit: (id: string | null) => {
      open = id;
    },
    titles: () => sketches.list().map((sketch) => sketch.title).sort(),
  };
}

describe('the sketches kept the same on every device', () => {
  it('takes one begun on one device to the other at its next sync, and sends nothing once both have it', async () => {
    const drive = new FolderDrive();
    const ipad = device(drive);
    const pc = device(drive);
    const idea = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Idea', 1);

    expect(await ipad.sync()).toEqual({ sent: 1, brought: 0, takenOff: 0, conflicts: 0 });
    const written = drive.files.get(SKETCHES_FILE)?.id;
    expect(await pc.sync()).toEqual({ sent: 0, brought: 1, takenOff: 0, conflicts: 0 });

    expect(pc.sketches.find(idea.id)?.events).toEqual(idea.events);
    expect(pc.sketches.find(idea.id)?.beats).toEqual(idea.beats);
    expect(drive.holds().sketches).toEqual([[idea.id, 'Idea', 1]]);
    // In step on both: nothing to send, and the drive not written again.
    const writes = drive.writes;
    expect(await ipad.sync()).toEqual({ sent: 0, brought: 0, takenOff: 0, conflicts: 0 });
    expect(await pc.sync()).toEqual({ sent: 0, brought: 0, takenOff: 0, conflicts: 0 });
    expect(drive.writes).toBe(writes);
    expect(pc.sketches.unsentSinceMs).toBeNull();
    // Written again, it is the same file, not another beside it.
    pc.sketches.rename(idea.id, 'Again');
    await pc.sync();
    expect(drive.files.get(SKETCHES_FILE)?.id).toBe(written);
  });

  it('takes a change made on one device to the other, a revision on', async () => {
    const drive = new FolderDrive();
    const ipad = device(drive);
    const pc = device(drive);
    const idea = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Idea', 1);
    await ipad.sync();
    await pc.sync();

    pc.sketches.changeTheNotes(idea.id, PLAYED.slice(0, 2));
    pc.sketches.rename(idea.id, 'Better');
    expect((await pc.sync()).sent).toBe(1);
    expect((await ipad.sync()).brought).toBe(1);

    expect(ipad.sketches.find(idea.id)?.title).toBe('Better');
    expect(ipad.sketches.find(idea.id)?.noteCount).toBe(1);
    expect(drive.holds().sketches).toEqual([[idea.id, 'Better', 2]]);
  });

  it('keeps both where one was changed on each device: the drive\'s under its name, this one\'s as a copy beside it', async () => {
    const drive = new FolderDrive();
    const ipad = device(drive);
    const pc = device(drive);
    const idea = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Idea', 1);
    await ipad.sync();
    await pc.sync();

    pc.sketches.changeTheNotes(idea.id, PLAYED.slice(0, 2));
    ipad.sketches.changeTheNotes(idea.id, [...PLAYED, on(900, 67), off(1_000, 67)]);
    await pc.sync();
    expect(await ipad.sync()).toEqual({ sent: 1, brought: 1, takenOff: 0, conflicts: 1 });

    // The drive's notes under the name; the iPad's in the copy.
    expect(ipad.sketches.find(idea.id)?.noteCount).toBe(1);
    const copy = ipad.sketches.find(`${idea.id}-copy`);
    expect([copy?.title, copy?.noteCount]).toEqual([`Idea (${CONFLICTING_COPY})`, 3]);
    // And the copy on the PC at its next sync.
    expect((await pc.sync()).brought).toBe(1);
    expect(pc.titles()).toEqual(['Idea', `Idea (${CONFLICTING_COPY})`]);
    expect(ipad.sketches.unsentSinceMs).toBeNull();
  });

  it('takes a deletion to the other device, and never sends back what was deleted', async () => {
    const drive = new FolderDrive();
    const ipad = device(drive);
    const pc = device(drive);
    const idea = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Idea', 1);
    const kept = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Kept', 2);
    await ipad.sync();
    await pc.sync();

    ipad.sketches.remove(idea.id);
    expect(await ipad.sync()).toEqual({ sent: 1, brought: 0, takenOff: 0, conflicts: 0 });
    expect(drive.holds()).toEqual({ sketches: [[kept.id, 'Kept', 1]], deleted: [[idea.id, 1]] });
    expect(ipad.sketches.forTheDrive().deleted).toEqual([]);

    expect(await pc.sync()).toEqual({ sent: 0, brought: 0, takenOff: 1, conflicts: 0 });
    expect(pc.titles()).toEqual(['Kept']);
    expect(pc.sketches.forTheDrive().deleted).toEqual([]);
    expect((await ipad.sync()).sent).toBe(0);
  });

  it('brings back one deleted here that another device changed since', async () => {
    const drive = new FolderDrive();
    const ipad = device(drive);
    const pc = device(drive);
    const idea = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Idea', 1);
    await ipad.sync();
    await pc.sync();

    pc.sketches.rename(idea.id, 'Changed on the PC');
    await pc.sync();
    ipad.sketches.remove(idea.id);
    expect(await ipad.sync()).toEqual({ sent: 0, brought: 1, takenOff: 0, conflicts: 0 });

    expect(ipad.titles()).toEqual(['Changed on the PC']);
    expect(drive.holds()).toEqual({ sketches: [[idea.id, 'Changed on the PC', 2]], deleted: [] });
    expect(ipad.sketches.forTheDrive().deleted).toEqual([]);
  });

  it('sends back one deleted elsewhere at a revision past its deletion, so every other device takes it', async () => {
    const drive = new FolderDrive();
    const ipad = device(drive);
    const pc = device(drive);
    const idea = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Idea', 1);
    await ipad.sync();
    await pc.sync();

    // Changed twice on the PC, then deleted there at revision 3.
    pc.sketches.rename(idea.id, 'Twice');
    await pc.sync();
    pc.sketches.rename(idea.id, 'Thrice');
    await pc.sync();
    pc.sketches.remove(idea.id);
    await pc.sync();
    expect(drive.holds().deleted).toEqual([[idea.id, 3]]);
    // Changed on the iPad at revision 1 meanwhile: back on the drive at 4.
    ipad.sketches.rename(idea.id, 'Wanted');
    await ipad.sync();
    expect(drive.holds()).toEqual({ sketches: [[idea.id, 'Wanted', 4]], deleted: [] });
  });

  it('sends back one deleted elsewhere that was changed here since', async () => {
    const drive = new FolderDrive();
    const ipad = device(drive);
    const pc = device(drive);
    const idea = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Idea', 1);
    await ipad.sync();
    await pc.sync();

    ipad.sketches.remove(idea.id);
    await ipad.sync();
    pc.sketches.rename(idea.id, 'Still wanted');
    expect(await pc.sync()).toEqual({ sent: 1, brought: 0, takenOff: 0, conflicts: 0 });
    expect(drive.holds()).toEqual({ sketches: [[idea.id, 'Still wanted', 2]], deleted: [] });

    expect((await ipad.sync()).brought).toBe(1);
    expect(ipad.titles()).toEqual(['Still wanted']);
  });

  it('leaves the sketch open in the editor as it is, and settles it at the sync after', async () => {
    const drive = new FolderDrive();
    const ipad = device(drive);
    const pc = device(drive);
    const idea = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Idea', 1);
    const other = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Other', 2);
    await ipad.sync();
    await pc.sync();

    pc.sketches.rename(idea.id, 'Renamed on the PC');
    pc.sketches.remove(other.id);
    await pc.sync();
    ipad.edit(idea.id);
    expect(await ipad.sync()).toEqual({ sent: 0, brought: 0, takenOff: 1, conflicts: 0 });
    expect(ipad.titles()).toEqual(['Idea']);
    // Nor taken off while open.
    ipad.edit(other.id);
    pc.sketches.remove(idea.id);
    ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Brought back', 3);
    await pc.sync();
    ipad.edit(idea.id);
    expect((await ipad.sync()).takenOff).toBe(0);
    expect(ipad.titles()).toContain('Idea');

    ipad.edit(null);
    expect((await ipad.sync()).takenOff).toBe(1);
    expect(ipad.titles()).not.toContain('Idea');
  });

  it('marks nothing sent where the drive could not be written, and sends it at the next sync', async () => {
    const drive = new FolderDrive();
    const ipad = device(drive);
    const idea = ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Idea', 1);
    ipad.sketches.begin({ events: PLAYED, beats: BEATS }, 'Doomed', 2);
    await ipad.sync();
    const doomed = ipad.sketches.list().find((sketch) => sketch.title === 'Doomed');
    ipad.sketches.remove(doomed?.id ?? '');
    ipad.sketches.rename(idea.id, 'Renamed');

    drive.failing = true;
    await expect(ipad.sync()).rejects.toThrow('could not be reached');
    expect(ipad.sketches.forTheDrive().here.map(({ unsent }) => unsent)).toEqual([true]);
    expect(ipad.sketches.forTheDrive().deleted).toHaveLength(1);

    drive.failing = false;
    expect((await ipad.sync()).sent).toBe(2);
    expect(drive.holds()).toEqual({ sketches: [[idea.id, 'Renamed', 2]], deleted: [[doomed?.id ?? '', 1]] });
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
        deleted: [['gone', 3], ['good', 1], ['nought', 0], 'not a pair', [5, 1]],
      }),
    });
    pc.sketches.begin({ events: PLAYED, beats: BEATS }, 'Mine', 1);
    expect(await pc.sync()).toEqual({ sent: 1, brought: 1, takenOff: 0, conflicts: 0 });
    expect(pc.titles()).toEqual(['Good', 'Mine']);
    // Written back without what it could not read: a deletion of a sketch
    // the drive has is no deletion, and one at no revision none.
    expect(drive.holds().deleted).toEqual([['gone', 3]]);

    const other = new FolderDrive();
    other.files.set(SKETCHES_FILE, { id: 'file-1', content: 'not json' });
    const fresh = device(other);
    fresh.sketches.begin({ events: PLAYED, beats: BEATS }, 'Mine', 1);
    expect((await fresh.sync()).sent).toBe(1);
    expect(other.holds().sketches.map(([, title]) => title)).toEqual(['Mine']);
  });
});
