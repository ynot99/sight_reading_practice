import { describe, expect, it } from 'vitest';
import {
  SOUNDFONT_CHOSEN_KEY,
  SOUNDFONT_KEY,
  SoundFontNotKept,
  SoundFontShelf,
} from '../../src/infrastructure/audio/SoundFontShelf.js';
import { SoundFontUnreadable } from '../../src/infrastructure/audio/soundFont.js';
import { GEN, writeSoundFont } from '../support/soundFontFile.js';
import { MemoryShelfDatabase, RecordingFontInstrument } from '../support/soundFontShelf.js';

/** A soundfont of three presets, written out of the order they are listed in. */
function threePresets(name = 'Inside name'): ArrayBuffer {
  const bytes = writeSoundFont({
    name,
    samples: [{ name: 'A', points: [1, 2, 3, 4] }],
    instruments: [{ name: 'Only', zones: [[[GEN.sampleID, 0]]] }],
    presets: [
      { name: 'Organ', bank: 0, program: 19, zones: [[[GEN.instrument, 0]]] },
      { name: 'Kit', bank: 128, program: 0, zones: [[[GEN.instrument, 0]]] },
      { name: 'Piano', bank: 0, program: 0, zones: [[[GEN.instrument, 0]]] },
    ],
  });
  return bytes.slice().buffer;
}

function aShelf(database: MemoryShelfDatabase | null = new MemoryShelfDatabase()) {
  const instrument = new RecordingFontInstrument();
  return { shelf: new SoundFontShelf(database, instrument), instrument, database };
}

describe('a soundfont kept on this device', () => {
  it('is kept under the name of its file, its presets by bank and program, and the first of them sounds', async () => {
    const { shelf, instrument, database } = aShelf();

    await shelf.keep('My Piano.SF2', threePresets());

    expect(shelf.kept).toEqual({
      name: 'My Piano',
      presets: [
        { name: 'Piano', bank: 0, program: 0 },
        { name: 'Organ', bank: 0, program: 19 },
        { name: 'Kit', bank: 128, program: 0 },
      ],
    });
    expect(shelf.chosen).toEqual({ bank: 0, program: 0 });
    expect(instrument.sounding).toBe('Piano');
    expect(database?.kept.get(SOUNDFONT_KEY)).toMatchObject({ name: 'My Piano' });
    expect(database?.kept.get(SOUNDFONT_CHOSEN_KEY)).toEqual({ bank: 0, program: 0 });
  });

  it('is called what it calls itself where its file has no name of its own', async () => {
    const { shelf } = aShelf();

    await shelf.keep('.sf2', threePresets('Called inside'));

    expect(shelf.kept?.name).toBe('Called inside');
  });

  it('sounds the preset chosen, and remembers it', async () => {
    const { shelf, instrument, database } = aShelf();
    await shelf.keep('font.sf2', threePresets());

    shelf.choose({ bank: 0, program: 19 });

    expect(instrument.sounding).toBe('Organ');
    expect(shelf.chosen).toEqual({ bank: 0, program: 19 });
    expect(database?.kept.get(SOUNDFONT_CHOSEN_KEY)).toEqual({ bank: 0, program: 19 });
  });

  it('goes back to the built-in piano, keeping the soundfont', async () => {
    const { shelf, instrument, database } = aShelf();
    await shelf.keep('font.sf2', threePresets());

    shelf.choose(null);

    expect(instrument.used.at(-1)).toBeNull();
    expect(shelf.chosen).toBeNull();
    expect(shelf.kept).not.toBeNull();
    expect(database?.kept.get(SOUNDFONT_CHOSEN_KEY)).toBeNull();
  });

  it('sounds the built-in piano for a preset the soundfont does not have', async () => {
    const { shelf, instrument } = aShelf();
    await shelf.keep('font.sf2', threePresets());

    shelf.choose({ bank: 5, program: 5 });

    expect(instrument.used.at(-1)).toBeNull();
    expect(shelf.chosen).toBeNull();
  });

  it('tells whoever listens of every change, until they stop listening', async () => {
    const { shelf } = aShelf();
    let told = 0;
    const stop = shelf.onChange(() => (told += 1));

    await shelf.keep('font.sf2', threePresets());
    shelf.choose(null);
    stop();
    shelf.choose({ bank: 0, program: 0 });

    expect(told).toBe(2);
  });

  it('refuses what is not a soundfont, and the one kept before stays', async () => {
    const { shelf, instrument, database } = aShelf();
    await shelf.keep('font.sf2', threePresets());
    const before = instrument.used.length;

    await expect(shelf.keep('notes.sf2', new TextEncoder().encode('<score-partwise/>').buffer)).rejects.toBeInstanceOf(
      SoundFontUnreadable,
    );

    expect(shelf.kept?.name).toBe('font');
    expect(instrument.used).toHaveLength(before);
    expect(database?.kept.get(SOUNDFONT_KEY)).toMatchObject({ name: 'font' });
  });

  it('says so where the device will not keep it, and changes nothing', async () => {
    const { shelf, instrument, database } = aShelf();
    if (database === null) {
      throw new Error('no database');
    }
    database.refusing = 'QuotaExceededError';

    const keeping = shelf.keep('font.sf2', threePresets());

    await expect(keeping).rejects.toBeInstanceOf(SoundFontNotKept);
    await expect(keeping).rejects.toThrow('font was read but this device would not keep it: QuotaExceededError.');
    expect(shelf.kept).toBeNull();
    expect(instrument.used).toEqual([]);
  });

  it('is kept for the visit where there is no database', async () => {
    const { shelf, instrument } = aShelf(null);

    await shelf.keep('font.sf2', threePresets());
    await shelf.open();

    expect(instrument.sounding).toBe('Piano');
  });
});

describe('a soundfont kept on an earlier visit', () => {
  it('is read again, and the preset chosen then sounds', async () => {
    const database = new MemoryShelfDatabase();
    const earlier = aShelf(database);
    await earlier.shelf.keep('font.sf2', threePresets());
    earlier.shelf.choose({ bank: 128, program: 0 });
    const { shelf, instrument } = aShelf(database);
    let told = 0;
    shelf.onChange(() => (told += 1));

    await shelf.open();

    expect(shelf.kept?.name).toBe('font');
    expect(instrument.sounding).toBe('Kit');
    expect(told).toBe(1);
  });

  it('is kept, the built-in piano sounding, where the piano was chosen then', async () => {
    const database = new MemoryShelfDatabase();
    const earlier = aShelf(database);
    await earlier.shelf.keep('font.sf2', threePresets());
    earlier.shelf.choose(null);
    const { shelf, instrument } = aShelf(database);

    await shelf.open();

    expect(shelf.kept).not.toBeNull();
    expect(instrument.used).toEqual([null]);
  });

  it('is let go of where it can no longer be read', async () => {
    const database = new MemoryShelfDatabase();
    database.kept.set(SOUNDFONT_KEY, { name: 'broken', bytes: new ArrayBuffer(16) });
    const { shelf, instrument } = aShelf(database);

    await shelf.open();

    expect(shelf.kept).toBeNull();
    expect(instrument.used).toEqual([]);
    expect(database.kept.has(SOUNDFONT_KEY)).toBe(false);
  });

  it('is let go of where what was kept is not a soundfont', async () => {
    for (const kept of [null, 'text', { name: 'x' }, { name: 'x', bytes: 'not bytes' }, { name: 'x', bytes: new ArrayBuffer(4) }]) {
      const database = new MemoryShelfDatabase();
      database.kept.set(SOUNDFONT_KEY, kept);
      const { shelf, instrument } = aShelf(database);

      await shelf.open();

      expect(shelf.kept, JSON.stringify(kept)).toBeNull();
      expect(instrument.used).toEqual([]);
      expect(database.kept.has(SOUNDFONT_KEY)).toBe(false);
    }
  });

  it('is called what it calls itself where it was kept without a name', async () => {
    const database = new MemoryShelfDatabase();
    database.kept.set(SOUNDFONT_KEY, { name: 3, bytes: threePresets('Called inside') });
    const { shelf } = aShelf(database);

    await shelf.open();

    expect(shelf.kept?.name).toBe('Called inside');
  });

  it('is nothing where nothing was kept', async () => {
    const { shelf, instrument } = aShelf();

    await shelf.open();

    expect(shelf.kept).toBeNull();
    expect(instrument.used).toEqual([]);
  });

  it('sounds the built-in piano where the choice kept is not one', async () => {
    for (const chosen of [undefined, null, 'Piano', 7, { bank: '0', program: 0 }, { bank: 0 }]) {
      const database = new MemoryShelfDatabase();
      database.kept.set(SOUNDFONT_KEY, { name: 'font', bytes: threePresets() });
      database.kept.set(SOUNDFONT_CHOSEN_KEY, chosen);
      const { shelf, instrument } = aShelf(database);

      await shelf.open();

      expect(shelf.kept?.name, JSON.stringify(chosen)).toBe('font');
      expect(instrument.used).toEqual([null]);
    }
  });

  it('is nothing where the database will not answer', async () => {
    const database = new MemoryShelfDatabase();
    database.get = () => Promise.reject(new Error('gone'));
    const { shelf, instrument } = aShelf(database);

    await shelf.open();

    expect(shelf.kept).toBeNull();
    expect(instrument.used).toEqual([]);
  });
});
