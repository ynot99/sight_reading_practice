import { describe, expect, it } from 'vitest';
import { BACKUP_KIND, BackupService, readBackup } from '../../src/application/Backup.js';
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';
import { InMemoryScoreStore, type StoredScore } from '../../src/application/ports/IScoreStore.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';

function score(id: string, title = id): StoredScore {
  return { id, title, savedAtMs: 1_000, bars: 8, musicXml: `<score-partwise>${id}</score-partwise>` };
}

function rig() {
  const settings = new InMemorySettingsStore();
  const takes = new InMemorySettingsStore();
  const scoreStore = new InMemoryScoreStore();
  const service = new BackupService({
    stores: new Map([
      ['settings', settings],
      ['takes', takes],
    ]),
    scoreStore,
    clock: new ManualClock(5_000),
  });
  return { settings, takes, scoreStore, service };
}

describe('carrying everything off this device', () => {
  it('takes what the stores hold, whatever it happens to mean', () => {
    // Every store already deals in an opaque blob and a codec already deals
    // in the meaning. A backup that understood settings would be a third
    // thing to keep in step, and would need changing for every new setting.
    const { settings, takes, scoreStore, service } = rig();
    settings.write({ practice: { tempoBpm: 84 } });
    takes.write({ takes: [{ id: 'take-1' }] });
    void scoreStore.write(score('score-1', 'Bone Bottom'));

    return service.create().then((document) => {
      expect(document.kind).toBe(BACKUP_KIND);
      expect(document.savedAtMs).toBe(5_000);
      expect(document.stores['settings']).toEqual({ practice: { tempoBpm: 84 } });
      expect(document.stores['takes']).toEqual({ takes: [{ id: 'take-1' }] });
      expect(document.scores.map((each) => each.title)).toEqual(['Bone Bottom']);
      // The document itself, not a summary: a score that cannot be reopened
      // is not backed up.
      expect(document.scores[0]?.musicXml).toContain('score-partwise');
    });
  });

  it('leaves out a store that has nothing in it', async () => {
    const { settings, service } = rig();
    settings.write({ practice: {} });

    const document = await service.create();

    expect(Object.keys(document.stores)).toEqual(['settings']);
  });

  it('survives the trip through a file', async () => {
    const { settings, scoreStore, service } = rig();
    settings.write({ practice: { tempoBpm: 84 } });
    await scoreStore.write(score('score-1'));

    const written = JSON.stringify(await service.create());
    const read = readBackup(JSON.parse(written));

    expect(read.stores['settings']).toEqual({ practice: { tempoBpm: 84 } });
    expect(read.scores).toHaveLength(1);
  });
});

describe('putting a backup back', () => {
  it('replaces the settings and adds the scores', async () => {
    const source = rig();
    source.settings.write({ practice: { tempoBpm: 84 } });
    await source.scoreStore.write(score('score-1'));
    const document = await source.service.create();

    const target = rig();
    const summary = await target.service.restore(document);

    expect(target.settings.read()).toEqual({ practice: { tempoBpm: 84 } });
    expect(await target.scoreStore.read('score-1')).not.toBeNull();
    expect(summary).toEqual({ stores: 1, scoresAdded: 1, scoresAlreadyHere: 0 });
  });

  it('leaves a score kept since the backup alone', async () => {
    // There is one answer to "which level am I on" and the file has it, but a
    // score kept since the backup was written is not something a restore has
    // any business deleting.
    const source = rig();
    await source.scoreStore.write(score('score-1'));
    const document = await source.service.create();

    const target = rig();
    await target.scoreStore.write(score('score-2', 'Kept since'));
    await target.service.restore(document);

    expect((await target.scoreStore.list()).map((each) => each.id).sort()).toEqual([
      'score-1',
      'score-2',
    ]);
  });

  it('changes nothing the second time the same file is put back', async () => {
    const source = rig();
    await source.scoreStore.write(score('score-1'));
    const document = await source.service.create();

    const target = rig();
    await target.service.restore(document);
    const second = await target.service.restore(document);

    expect(second.scoresAdded).toBe(0);
    expect(second.scoresAlreadyHere).toBe(1);
    expect(await target.scoreStore.list()).toHaveLength(1);
  });

  it('says plainly when the file is not one of ours', () => {
    expect(() => readBackup({ hello: 'world' })).toThrow(/not a backup/);
    expect(() => readBackup(null)).toThrow(/not a backup/);
  });

  it('refuses a backup from a newer version rather than half-reading it', () => {
    // Half-restoring a file we do not understand is worse than refusing it:
    // the reader would be left with some of their old device and some of
    // their new one, and no way to tell which parts.
    expect(() => readBackup({ kind: BACKUP_KIND, version: 99, stores: {}, scores: [] })).toThrow(
      /newer version/,
    );
  });

  it('drops a score entry that could not be reopened, and keeps the rest', () => {
    const read = readBackup({
      kind: BACKUP_KIND,
      version: 1,
      savedAtMs: 0,
      stores: {},
      scores: [{ id: 'broken' }, score('score-1')],
    });

    expect(read.scores.map((each) => each.id)).toEqual(['score-1']);
  });
});
