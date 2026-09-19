import { describe, expect, it } from 'vitest';
import { DriveSync, SYNC_AFTER_QUIET_MS } from '../../src/application/DriveSync.js';
import type { StoredScoreSummary } from '../../src/application/ports/IScoreStore.js';
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';
import { SettingsRepository } from '../../src/application/SettingsRepository.js';

const KNOWN = { presetIds: [], modeIds: [], scoringIds: [], rhythmProfileIds: [] };

function kept(title: string, fields: Partial<StoredScoreSummary> = {}): StoredScoreSummary {
  return { id: `score:${title}`, title, savedAtMs: 1_000, openedAtMs: 1_000, bars: 8, passages: [], ...fields };
}

/** A device: its scores, its settings, and a clock the test moves. */
function device(scores: StoredScoreSummary[] = [], store = new InMemorySettingsStore()) {
  const repository = new SettingsRepository(store, KNOWN);
  repository.load();
  let now = 10_000;
  const shelf = [...scores];
  const sync = new DriveSync({
    library: {
      sync: () => Promise.resolve({ sent: 0, brought: 0, onlyOnTheDrive: [] }),
    },
    settings: { sync: () => Promise.resolve('same' as const) },
    scores: () => shelf,
    repository,
    now: () => now,
  });
  return {
    sync,
    shelf,
    repository,
    store,
    later: (ms: number) => {
      now += ms;
    },
  };
}

describe('whether this device has something the drive has not', () => {
  it('has nothing right after a sync', async () => {
    const pc = device([kept('Clair de Lune')]);

    await pc.sync.sync();

    expect(pc.sync.hasSomethingToSync).toBe(false);
  });

  it('has something once a score is kept here after it', async () => {
    const pc = device([kept('Clair de Lune')]);
    await pc.sync.sync();

    pc.shelf.push(kept('Shellwood', { savedAtMs: 20_000 }));

    expect(pc.sync.hasSomethingToSync).toBe(true);
  });

  it('counts stars given here as something to send', async () => {
    const pc = device([kept('Clair de Lune')]);
    await pc.sync.sync();

    pc.shelf[0] = kept('Clair de Lune', { stars: 6, markedAtMs: 20_000 });

    expect(pc.sync.hasSomethingToSync).toBe(true);
  });

  it('does not count opening a piece', async () => {
    const pc = device([kept('Clair de Lune')]);
    await pc.sync.sync();

    pc.shelf[0] = kept('Clair de Lune', { openedAtMs: 20_000 });

    expect(pc.sync.hasSomethingToSync).toBe(false);
  });

  it('counts a changed setting', async () => {
    const pc = device([kept('Clair de Lune')]);
    await pc.sync.sync();

    pc.repository.adoptSettings({ values: { tempoPercent: 70 }, changedAtMs: 20_000 });

    expect(pc.sync.hasSomethingToSync).toBe(true);
  });

  it('has something where it has never synced and holds a library, and nothing where it holds nothing', () => {
    expect(device([kept('Clair de Lune')]).sync.hasSomethingToSync).toBe(true);
    expect(device([]).sync.hasSomethingToSync).toBe(false);
  });

  it('takes nothing brought from a device whose clock runs ahead as a change made here', async () => {
    // Brought here with a moment later than this device's now.
    const pc = device([kept('Clair de Lune', { stars: 6, markedAtMs: 50_000 })]);

    await pc.sync.sync();

    expect(pc.sync.hasSomethingToSync).toBe(false);
  });

  it('remembers the sync across a visit', async () => {
    const store = new InMemorySettingsStore();
    await device([kept('Clair de Lune')], store).sync.sync();

    const again = device([kept('Clair de Lune')], store);

    expect(again.sync.hasSomethingToSync).toBe(false);
    expect(again.repository.lastSyncedAtMs).toBe(10_000);
  });
});

describe('when a sync nobody pressed for is due', () => {
  it('is half a minute after the last change here', async () => {
    const pc = device([kept('Clair de Lune')]);
    await pc.sync.sync();

    pc.shelf.push(kept('Shellwood', { savedAtMs: 20_000 }));

    expect(pc.sync.dueAtMs).toBe(20_000 + SYNC_AFTER_QUIET_MS);
    expect(SYNC_AFTER_QUIET_MS).toBe(30_000);
  });

  it('is put off by every change after it', async () => {
    const pc = device([kept('Clair de Lune')]);
    await pc.sync.sync();
    pc.shelf.push(kept('Shellwood', { savedAtMs: 20_000 }));

    pc.shelf.push(kept('Hornet', { savedAtMs: 35_000 }));

    expect(pc.sync.dueAtMs).toBe(35_000 + SYNC_AFTER_QUIET_MS);
  });

  it('is never while the drive has had everything', async () => {
    const pc = device([kept('Clair de Lune')]);

    await pc.sync.sync();

    expect(pc.sync.dueAtMs).toBeNull();
  });
});
