import { describe, expect, it } from 'vitest';
import { readSoundFont, SoundFontUnreadable, type SoundZone } from '../../src/infrastructure/audio/soundFont.js';
import {
  GEN,
  range,
  writeSoundFont,
  type FileDescription,
  type FileSample,
  type FileZone,
} from '../support/soundFontFile.js';

/** A recording of `count` points, each its own index, so where a zone points can be read off it. */
function counting(name: string, count: number, extra: Partial<FileSample> = {}): FileSample {
  return { name, points: Array.from({ length: count }, (_, index) => index), ...extra };
}

/** One recording, one instrument of one zone, one preset over it - with the zones as said. */
function aFont(
  instrumentZones: readonly FileZone[] = [[[GEN.sampleID, 0]]],
  presetZones: readonly FileZone[] = [[[GEN.instrument, 0]]],
  samples: readonly FileSample[] = [counting('A', 100)],
): FileDescription {
  return {
    name: 'Little font',
    samples,
    instruments: [{ name: 'Only', zones: instrumentZones }],
    presets: [{ name: 'Only', bank: 0, program: 0, zones: presetZones }],
  };
}

function zonesOf(description: FileDescription, preset = 0): readonly SoundZone[] {
  return readSoundFont(writeSoundFont(description)).presets[preset]?.zones ?? [];
}

function theZone(description: FileDescription): SoundZone {
  const [zone, ...more] = zonesOf(description);
  expect(more).toEqual([]);
  if (zone === undefined) {
    throw new Error('no zone read');
  }
  return zone;
}

describe('reading a soundfont', () => {
  it('reads its name and its presets, each by name, bank and program', () => {
    const font = readSoundFont(
      writeSoundFont({
        name: 'Two pianos',
        // Five bytes with its end, and a byte of padding after them to be read past.
        comment: 'abcd',
        samples: [counting('A', 10)],
        instruments: [{ name: 'Piano', zones: [[[GEN.sampleID, 0]]] }],
        presets: [
          { name: 'Bright', bank: 0, program: 1, zones: [[[GEN.instrument, 0]]] },
          { name: 'Kit', bank: 128, program: 0, zones: [[[GEN.instrument, 0]]] },
        ],
      }),
    );

    expect(font.name).toBe('Two pianos');
    expect(font.presets[0]?.zones).toHaveLength(1);
    expect(font.presets.map(({ name, bank, program }) => ({ name, bank, program }))).toEqual([
      { name: 'Bright', bank: 0, program: 1 },
      { name: 'Kit', bank: 128, program: 0 },
    ]);
  });

  it('says where each recording lies among the points, and its loop', () => {
    const description = aFont(
      [[[GEN.sampleID, 0]], [[GEN.sampleID, 1]]],
      undefined,
      [counting('First', 30), counting('Second', 50, { loop: [10, 40], sampleRate: 22_050 })],
    );
    const font = readSoundFont(writeSoundFont(description));
    const [first, second] = font.presets[0]?.zones ?? [];

    expect(first?.sampleName).toBe('First');
    expect(second?.sampleName).toBe('Second');
    expect(second?.sampleRate).toBe(22_050);
    // The second follows the first and the silence after it.
    const from = second?.start ?? 0;
    expect(from).toBe(30 + 46);
    expect(second?.end).toBe(from + 50);
    expect([second?.loopStart, second?.loopEnd]).toEqual([from + 10, from + 40]);
    expect(Array.from(font.sampleData.subarray(from, from + 5))).toEqual([0, 1, 2, 3, 4]);
  });

  it('reads the points where they lie, however the bytes are placed', () => {
    const file = writeSoundFont(aFont(undefined, undefined, [{ name: 'A', points: [-32_768, -1, 0, 1, 32_767] }]));
    // Sixteen-bit values cannot be read in place from an odd byte.
    const shifted = new Uint8Array(file.length + 1);
    shifted.set(file, 1);

    const font = readSoundFont(shifted.subarray(1));

    expect(Array.from(font.sampleData.subarray(0, 5))).toEqual([-32_768, -1, 0, 1, 32_767]);
  });

  it('gives a zone that says nothing the whole keyboard, every strength, and the recording as it is', () => {
    const zone = theZone(aFont(undefined, undefined, [counting('A', 100, { originalKey: 57, correctionCents: -7 })]));

    expect(zone.keys).toEqual({ low: 0, high: 127 });
    expect(zone.velocities).toEqual({ low: 0, high: 127 });
    expect(zone.rootKey).toBe(57);
    expect(zone.correctionCents).toBe(-7);
    expect(zone.loop).toBe('none');
    expect(zone.settings).toEqual({
      coarseTune: 0,
      fineTune: 0,
      scaleTuning: 100,
      initialAttenuation: 0,
      pan: 0,
      initialFilterFc: 13_500,
      initialFilterQ: 0,
      delayVolEnv: -12_000,
      attackVolEnv: -12_000,
      holdVolEnv: -12_000,
      decayVolEnv: -12_000,
      sustainVolEnv: 0,
      releaseVolEnv: -12_000,
      keynumToVolEnvHold: 0,
      keynumToVolEnvDecay: 0,
      exclusiveClass: 0,
    });
  });

  it('narrows the keys and strengths an instrument zone covers to the preset zone over it', () => {
    const zone = theZone(
      aFont(
        [[[GEN.keyRange, range(40, 70)], [GEN.velRange, range(0, 90)], [GEN.sampleID, 0]]],
        [[[GEN.keyRange, range(60, 100)], [GEN.velRange, range(50, 127)], [GEN.instrument, 0]]],
      ),
    );

    expect(zone.keys).toEqual({ low: 60, high: 70 });
    expect(zone.velocities).toEqual({ low: 50, high: 90 });
  });

  it('keeps a zone the two ranges share a single key of', () => {
    const zone = theZone(aFont([[[GEN.keyRange, range(40, 60)], [GEN.sampleID, 0]]], [[[GEN.keyRange, range(60, 90)], [GEN.instrument, 0]]]));

    expect(zone.keys).toEqual({ low: 60, high: 60 });
  });

  it('leaves out an instrument zone the preset zone shares no key or no strength with', () => {
    const zones = zonesOf(
      aFont(
        [
          [[GEN.keyRange, range(0, 59)], [GEN.sampleID, 0]],
          [[GEN.keyRange, range(60, 127)], [GEN.sampleID, 0]],
          [[GEN.keyRange, range(60, 127)], [GEN.velRange, range(0, 40)], [GEN.sampleID, 0]],
        ],
        [[[GEN.keyRange, range(60, 127)], [GEN.velRange, range(41, 127)], [GEN.instrument, 0]]],
      ),
    );

    expect(zones.map((zone) => [zone.keys, zone.velocities])).toEqual([
      [{ low: 60, high: 127 }, { low: 41, high: 127 }],
    ]);
  });

  it("starts an instrument's zones from its global zone, each zone's own word standing over it", () => {
    const zones = zonesOf(
      aFont([
        [[GEN.initialAttenuation, 40], [GEN.releaseVolEnv, 1_000], [GEN.sampleModes, 1]],
        [[GEN.keyRange, range(0, 59)], [GEN.sampleID, 0]],
        [[GEN.keyRange, range(60, 127)], [GEN.initialAttenuation, 10], [GEN.sampleID, 0]],
      ]),
    );

    expect(zones.map((zone) => zone.settings.initialAttenuation)).toEqual([40, 10]);
    expect(zones.map((zone) => zone.settings.releaseVolEnv)).toEqual([1_000, 1_000]);
    expect(zones.map((zone) => zone.loop)).toEqual(['continuous', 'continuous']);
  });

  it('takes a zone without a recording as global only where it comes first', () => {
    const zones = zonesOf(
      aFont([
        [[GEN.keyRange, range(0, 59)], [GEN.sampleID, 0]],
        [[GEN.initialAttenuation, 40]],
        [[GEN.keyRange, range(60, 127)], [GEN.sampleID, 0]],
      ]),
    );

    expect(zones.map((zone) => zone.settings.initialAttenuation)).toEqual([0, 0]);
  });

  it("adds what a preset says to what its instrument says, the preset's own zone over its global one", () => {
    const zone = theZone(
      aFont(
        [[[GEN.initialAttenuation, 30], [GEN.coarseTune, -12], [GEN.holdVolEnv, 2_000], [GEN.pan, -200], [GEN.sampleID, 0]]],
        [
          [[GEN.initialAttenuation, 100], [GEN.holdVolEnv, 600], [GEN.pan, 500]],
          [[GEN.initialAttenuation, 20], [GEN.coarseTune, 12], [GEN.instrument, 0]],
        ],
      ),
    );

    // The preset's zone says 20 over its global 100, and 20 is added.
    expect(zone.settings.initialAttenuation).toBe(50);
    expect(zone.settings.coarseTune).toBe(0);
    // Said only in the preset's global zone, and added all the same.
    expect(zone.settings.holdVolEnv).toBe(2_600);
    expect(zone.settings.pan).toBe(300);
    // Nudged from the default where the instrument says nothing.
    const nudged = theZone(aFont(undefined, [[[GEN.decayVolEnv, 1_200], [GEN.instrument, 0]]]));
    expect(nudged.settings.decayVolEnv).toBe(-12_000 + 1_200);
  });

  it('does not let a preset say what only an instrument may', () => {
    const zone = theZone(
      aFont(
        [[[GEN.sampleID, 0]]],
        [
          [
            [GEN.sampleModes, 1],
            [GEN.exclusiveClass, 3],
            [GEN.overridingRootKey, 72],
            [GEN.startAddrsOffset, 5],
            [GEN.instrument, 0],
          ],
        ],
      ),
    );

    expect(zone.loop).toBe('none');
    expect(zone.settings.exclusiveClass).toBe(0);
    expect(zone.rootKey).toBe(60);
    expect(zone.start).toBe(0);
  });

  it("reads the instrument's class, by which zones cut each other off", () => {
    expect(theZone(aFont([[[GEN.exclusiveClass, 1], [GEN.sampleID, 0]]])).settings.exclusiveClass).toBe(1);
  });

  it("takes the key a zone says it sounds as over its recording's, and middle C for one with none", () => {
    const sample = [counting('A', 10, { originalKey: 48 })];
    expect(theZone(aFont([[[GEN.overridingRootKey, 72], [GEN.sampleID, 0]]], undefined, sample)).rootKey).toBe(72);
    expect(theZone(aFont([[[GEN.overridingRootKey, -1], [GEN.sampleID, 0]]], undefined, sample)).rootKey).toBe(48);
    expect(theZone(aFont(undefined, undefined, [counting('A', 10, { originalKey: 255 })])).rootKey).toBe(60);
  });

  it('moves where a recording and its loop begin and end, by points and by blocks of 32768', () => {
    const points = 40_000;
    const zone = theZone(
      aFont(
        [
          [
            [GEN.startAddrsOffset, 7],
            [GEN.endAddrsCoarseOffset, -1],
            [GEN.endAddrsOffset, -3],
            [GEN.startloopAddrsOffset, 100],
            [GEN.startloopAddrsCoarseOffset, 0],
            [GEN.endloopAddrsOffset, 2],
            [GEN.endloopAddrsCoarseOffset, -1],
            [GEN.sampleID, 0],
          ],
        ],
        undefined,
        [counting('Long', points, { loop: [1_000, 39_000] })],
      ),
    );

    expect(zone.start).toBe(7);
    expect(zone.end).toBe(points - 32_768 - 3);
    expect(zone.loopStart).toBe(1_100);
    expect(zone.loopEnd).toBe(39_000 + 2 - 32_768);
  });

  it('keeps a moved address inside the recordings', () => {
    const zone = theZone(aFont([[[GEN.startAddrsOffset, -50], [GEN.endAddrsCoarseOffset, 1], [GEN.sampleID, 0]]]));

    expect(zone.start).toBe(0);
    expect(zone.end).toBeLessThanOrEqual(100 + 46);
  });

  it('loops as the zone says: not at all, round and round, or while the key is held', () => {
    const loopOf = (mode: number) => theZone(aFont([[[GEN.sampleModes, mode], [GEN.sampleID, 0]]])).loop;

    expect([0, 1, 2, 3].map(loopOf)).toEqual(['none', 'continuous', 'none', 'until-release']);
  });

  it('flattens every instrument zone under every preset zone, in order', () => {
    const description: FileDescription = {
      samples: [counting('Low', 10), counting('High', 10)],
      instruments: [
        {
          name: 'Two',
          zones: [
            [[GEN.keyRange, range(0, 59)], [GEN.sampleID, 0]],
            [[GEN.keyRange, range(60, 127)], [GEN.sampleID, 1]],
          ],
        },
      ],
      presets: [
        {
          name: 'Layered',
          zones: [
            [[GEN.velRange, range(0, 63)], [GEN.initialAttenuation, 60], [GEN.instrument, 0]],
            [[GEN.velRange, range(64, 127)], [GEN.instrument, 0]],
          ],
        },
      ],
    };

    expect(
      zonesOf(description).map((zone) => [zone.sampleName, zone.velocities.low, zone.settings.initialAttenuation]),
    ).toEqual([
      ['Low', 0, 60],
      ['High', 0, 60],
      ['Low', 64, 0],
      ['High', 64, 0],
    ]);
  });

  it('passes over a zone whose instrument or recording is not there', () => {
    const zones = zonesOf(
      aFont(
        // The one after the last is the record that only closes the list.
        [[[GEN.sampleID, 1]], [[GEN.sampleID, 0]]],
        [[[GEN.instrument, 9]], [[GEN.instrument, 0]]],
      ),
    );

    expect(zones).toHaveLength(1);
  });

  it("passes over a recording kept in a synthesiser's memory rather than the file", () => {
    const zones = zonesOf(
      aFont([[[GEN.sampleID, 0]], [[GEN.sampleID, 1]]], undefined, [
        counting('In ROM', 10, { type: 0x8001 }),
        // What follows the end of a name is not its.
        counting('Here\0junk', 10),
      ]),
    );

    expect(zones.map((zone) => zone.sampleName)).toEqual(['Here']);
  });
});

describe('a soundfont that cannot be read', () => {
  const refused = (bytes: Uint8Array): string => {
    try {
      readSoundFont(bytes);
    } catch (error) {
      expect(error).toBeInstanceOf(SoundFontUnreadable);
      return (error as Error).message;
    }
    throw new Error('read');
  };

  it('is something else altogether', () => {
    expect(refused(new TextEncoder().encode('<score-partwise/>'))).toContain('not a soundfont');
    const wave = writeSoundFont(aFont());
    wave.set(new TextEncoder().encode('WAVE'), 8);
    expect(refused(wave)).toContain('not a soundfont');
  });

  it('is cut short', () => {
    const file = writeSoundFont(aFont());

    expect(refused(file.subarray(0, file.length - 60))).toContain('cut short');
  });

  it('lacks a part every one has', () => {
    const file = writeSoundFont(aFont());
    const at = new TextDecoder('latin1').decode(file).indexOf('shdr');
    file.set(new TextEncoder().encode('xxxx'), at);

    expect(refused(file)).toContain('no shdr');
  });

  it('keeps its recordings compressed, as an SF3 does', () => {
    expect(refused(writeSoundFont({ ...aFont(), version: [3, 1] }))).toContain('SF3');
    expect(refused(writeSoundFont(aFont(undefined, undefined, [counting('A', 10, { type: 0x11 })])))).toContain('SF3');
  });

  it('points a zone past the generators it has', () => {
    const file = writeSoundFont(aFont());
    const at = new TextDecoder('latin1').decode(file).indexOf('ibag') + 8;
    // The terminal bag, saying the generators run on past the end.
    new DataView(file.buffer).setUint16(at + 4, 500, true);

    expect(refused(file)).toContain('generators it does not have');
  });

  it('points an instrument past the zones it has', () => {
    const file = writeSoundFont(aFont());
    const at = new TextDecoder('latin1').decode(file).indexOf('inst') + 8;
    // The terminal instrument, saying its zones run on past the last bag.
    new DataView(file.buffer).setUint16(at + 22 + 20, 9, true);

    expect(refused(file)).toContain('zones it does not have');
  });
});
