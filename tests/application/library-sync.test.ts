import { describe, expect, it } from 'vitest';
import { LibrarySync, type DriveScore } from '../../src/application/LibrarySync.js';
import type { CloudFile, ICloudDrive } from '../../src/application/ports/ICloudDrive.js';
import { InMemoryScoreStore, type StoredScore } from '../../src/application/ports/IScoreStore.js';

/** A drive folder as a map of names to contents. */
class FolderDrive implements ICloudDrive {
  readonly signedIn = true;
  readonly files = new Map<string, { id: string; content: string }>();
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
    const id = replacing ?? `file-${String((this.made += 1))}`;
    this.files.set(name, { id, content });
    return Promise.resolve({ id, name });
  }

  index(): DriveScore[] {
    return (JSON.parse(this.files.get('library.json')?.content ?? '{"scores":[]}') as {
      scores: DriveScore[];
    }).scores;
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

/** Two devices sharing one drive. */
async function devices(): Promise<{
  drive: FolderDrive;
  device: (scores: StoredScore[]) => Promise<{ store: InMemoryScoreStore; sync: LibrarySync }>;
}> {
  const drive = new FolderDrive();
  const device = async (scores: StoredScore[]) => {
    const store = new InMemoryScoreStore();
    for (const each of scores) {
      await store.write(each);
    }
    return { store, sync: new LibrarySync({ drive, store, reload: () => Promise.resolve() }) };
  };
  return Promise.resolve({ drive, device });
}

describe('keeping the library the same on every device', () => {
  it('sends every score the drive does not have, and lists them there', async () => {
    const { drive, device } = await devices();
    const pc = await device([score('Clair de Lune', { stars: 6.5, markedAtMs: 2_000 })]);

    const outcome = await pc.sync.sync();

    expect(outcome.sent).toBe(1);
    expect(drive.files.get('Clair de Lune.musicxml')?.content).toBe('<score>Clair de Lune</score>');
    expect(drive.index()[0]).toMatchObject({ title: 'Clair de Lune', stars: 6.5, markedAtMs: 2_000 });
  });

  it('lists what only the drive has, and brings one here with its stars', async () => {
    // His: a new device connects the drive and takes the scores from it.
    const { device } = await devices();
    await (await device([score('City of Tears', { stars: 4, markedAtMs: 2_000 })])).sync.sync();
    const ipad = await device([]);

    const outcome = await ipad.sync.sync();
    expect(outcome.onlyOnTheDrive.map((each) => each.title)).toEqual(['City of Tears']);
    expect(await ipad.store.list()).toEqual([]);

    const [cityOfTears] = outcome.onlyOnTheDrive;
    if (cityOfTears === undefined) {
      throw new Error('listed');
    }
    await ipad.sync.bringHere(cityOfTears);

    const kept = await ipad.store.read('score:City of Tears');
    expect(kept?.musicXml).toBe('<score>City of Tears</score>');
    expect(kept?.stars).toBe(4);
  });

  it('takes the newer word on the marks, from whichever side said it', async () => {
    const { device } = await devices();
    const pc = await device([score('Shellwood', { stars: 3, markedAtMs: 2_000 })]);
    await pc.sync.sync();
    const ipad = await device([score('Shellwood', { stars: 8, markedAtMs: 5_000 })]);

    await ipad.sync.sync();
    await pc.sync.sync();

    expect((await pc.store.read('score:Shellwood'))?.stars).toBe(8);
    expect((await ipad.store.read('score:Shellwood'))?.stars).toBe(8);
  });

  it('keeps marks made here when the drive has older ones', async () => {
    const { device } = await devices();
    await (await device([score('Shellwood', { stars: 8, markedAtMs: 5_000 })])).sync.sync();
    const pc = await device([score('Shellwood', { stars: 3, markedAtMs: 9_000 })]);

    await pc.sync.sync();

    expect((await pc.store.read('score:Shellwood'))?.stars).toBe(3);
  });

  it('takes a document kept again elsewhere, without losing the marks made here', async () => {
    // Imported again after an edit in MuseScore on one device; judged afresh
    // on the other.
    const { device } = await devices();
    await (
      await device([score('Dirtmouth', { savedAtMs: 7_000, musicXml: '<score>edited</score>' })])
    ).sync.sync();
    const pc = await device([score('Dirtmouth', { stars: 5, markedAtMs: 8_000 })]);

    await pc.sync.sync();

    const kept = await pc.store.read('score:Dirtmouth');
    expect(kept?.musicXml).toBe('<score>edited</score>');
    expect(kept?.stars).toBe(5);
  });

  it('reads marks kept before they had a moment as made no earlier than the piece was kept', async () => {
    // Stars given before this version have no moment of their own. A piece
    // can only be judged once it is kept, so they were given after it was:
    // newer than a word said elsewhere before the piece arrived here.
    const { device } = await devices();
    await (await device([score('Bone Bottom', { stars: 3, markedAtMs: 1_500 })])).sync.sync();
    const pc = await device([score('Bone Bottom', { stars: 7, savedAtMs: 2_000 })]);

    await pc.sync.sync();

    expect((await pc.store.read('score:Bone Bottom'))?.stars).toBe(7);
  });

  it('lets a device that has said nothing about a piece take the marks from one that has', async () => {
    const { device } = await devices();
    await (await device([score('Bone Bottom', { stars: 7 })])).sync.sync();
    const ipad = await device([score('Bone Bottom')]);

    await ipad.sync.sync();

    expect((await ipad.store.read('score:Bone Bottom'))?.stars).toBe(7);
  });

  it('takes whichever device opened a piece last as when it was opened', async () => {
    const { device } = await devices();
    await (await device([score('Senbonzakura', { openedAtMs: 9_000 })])).sync.sync();
    const pc = await device([score('Senbonzakura', { openedAtMs: 3_000 })]);

    await pc.sync.sync();

    expect((await pc.store.read('score:Senbonzakura'))?.openedAtMs).toBe(9_000);
  });

  it('reads a list it cannot make sense of as an empty drive', async () => {
    const { drive, device } = await devices();
    await drive.write('library.json', 'not json', null);
    const pc = await device([score('Clair de Lune')]);

    const outcome = await pc.sync.sync();

    expect(outcome.sent).toBe(1);
    expect(drive.index().map((each) => each.title)).toEqual(['Clair de Lune']);
  });
});
