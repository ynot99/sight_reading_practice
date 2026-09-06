import { describe, expect, it } from 'vitest';
import { KEYBOARD_SIZES, keyCountOf, keysOf } from '../../src/domain/generation/keyboards.js';
import { playableRange } from '../../src/domain/generation/voices/IVoiceGenerator.js';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';

/** A range, said the way a reader would say it. */
function said(range: { lowest: Pitch; highest: Pitch }): string {
  return `${range.lowest.toString()}-${range.highest.toString()}`;
}

function range(lowest: string, highest: string) {
  return { lowest: Pitch.parse(lowest), highest: Pitch.parse(highest) };
}

describe('the keys the reader actually has', () => {
  it('says how many each keyboard has, by its own name', () => {
    // Named by how many keys they have, which is how they are sold.
    expect(keyCountOf('88')).toBe(88);
    expect(keyCountOf('61')).toBe(61);
    expect(keyCountOf('49')).toBe(49);
    expect(keyCountOf('25')).toBe(25);
    expect(keysOf('any')).toBeNull();
  });

  it('leaves a voice alone where the whole piano is available', () => {
    const wide = range('F2', 'C6');

    expect(playableRange(wide, undefined)).toBe(wide);
  });

  it('trims a voice to the keys there are', () => {
    const wide = range('C2', 'C7');

    expect(said(playableRange(wide, keysOf('49') ?? wide))).toBe('C2-C6');
  });

  it('moves a bass line up rather than leaving a hand nothing to play', () => {
    // A bass line on a two-octave keyboard is played an octave or two up,
    // and it is still a bass line. Trimmed without being moved it would be
    // an empty range, and the exercise would be silence.
    const bass = range('F2', 'C4');

    const moved = playableRange(bass, keysOf('25') ?? bass);

    expect(said(moved)).toBe('F3-C5');
  });

  it('moves a high voice down for the same reason', () => {
    const high = range('C6', 'C7');

    const moved = playableRange(high, range('C3', 'C5'));

    expect(said(moved)).toBe('C4-C5');
  });

  it('gives back the instrument itself where nothing of the voice survives', () => {
    // A keyboard narrower than the step between the two ends of a voice.
    const voice = range('C4', 'C4');
    const tiny = range('D4', 'E4');

    expect(said(playableRange(voice, tiny))).toBe('D4-E4');
  });

  it('keeps every generated exercise inside them', () => {
    // The point of the whole thing: a level is the same level on a laptop
    // and on a grand, and only the octaves it is played in differ.
    const keys = keysOf('49');
    if (keys === null) {
      throw new Error('expected keys');
    }
    const rhythm = BUILT_IN_RHYTHM_PROFILES[0];
    if (rhythm === undefined) {
      throw new Error('expected a rhythm profile');
    }
    for (const preset of BUILT_IN_PRESETS) {
      const exercise = preset.generator.generate({
        measures: 4,
        timeSignature: new TimeSignature(4, 4),
        key: KeySignature.major(0),
        tempoBpm: 84,
        rhythm,
        seed: 7,
        withinRange: keys,
      });
      const played = exercise.staves
        .flatMap((staff) => staff.measures)
        .flatMap((measure) => measure.entries)
        .flatMap((entry) => (entry.kind === 'note' ? entry.pitches : []));
      for (const pitch of played) {
        expect(pitch.midi, `${preset.id} played ${pitch.toString()}`).toBeGreaterThanOrEqual(
          keys.lowest.midi,
        );
        expect(pitch.midi, `${preset.id} played ${pitch.toString()}`).toBeLessThanOrEqual(
          keys.highest.midi,
        );
      }
    }
  });

  it('offers a size for every keyboard it knows', () => {
    for (const size of KEYBOARD_SIZES) {
      expect(size === 'any' ? keysOf(size) === null : keysOf(size) !== null).toBe(true);
    }
  });
});
