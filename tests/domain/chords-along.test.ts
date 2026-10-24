import { describe, expect, it } from 'vitest';
import { theChordsAlongTheBars, theNotesOfEachBar, theNotesThePedalHolds, type BarOfBeats, type NoteSounding } from '../../src/domain/harmony/chordsAlong.js';

const C4 = 60;
const BEAT_MS = 500;

/** Bars of four beats, end to end from nought. */
function barsOfFour(count: number, beats = 4): BarOfBeats[] {
  return Array.from({ length: count }, (_, bar) => ({
    beatsMs: Array.from({ length: beats }, (__, beat) => (bar * beats + beat) * BEAT_MS),
    untilMs: (bar + 1) * beats * BEAT_MS,
  }));
}

/** Keys struck together on a beat, held for some beats. */
function struck(midis: readonly number[], onBeat: number, beats: number): NoteSounding[] {
  return midis.map((midi) => ({ midi, fromMs: onBeat * BEAT_MS, untilMs: (onBeat + beats) * BEAT_MS }));
}

const C = [C4, C4 + 4, C4 + 7];
const F = [C4 + 5, C4 + 9, C4 + 12];
const G = [C4 + 7, C4 + 11, C4 + 14];
const Am = [C4 - 3, C4, C4 + 4];

/** What the lane says: each stretch's beats, name and degree, and whether exactly. */
function said(notes: readonly NoteSounding[], bars: readonly BarOfBeats[], keys: Parameters<typeof theChordsAlongTheBars>[2] = []): string[] {
  return theChordsAlongTheBars(notes, bars, keys).map(
    (chord) =>
      `${String(chord.fromMs / BEAT_MS)}-${String(chord.untilMs / BEAT_MS)} ${chord.name} ${chord.numeral}${chord.exactly ? '' : ' ≈'}`,
  );
}

describe('the chords along the bars', () => {
  it('names a bar held as one chord once, and the same chord on into the next bar as one stretch', () => {
    expect(said(struck(C, 0, 4), barsOfFour(1))).toEqual(['0-4 C I']);
    expect(said([...struck(C, 0, 4), ...struck(C, 4, 4), ...struck(Am, 8, 4)], barsOfFour(3))).toEqual(['0-8 C I', '8-12 Am vi']);
  });

  it('cuts a bar where its halves are two chords, and a half where its beats are, down to a beat', () => {
    expect(said([...struck(C, 0, 2), ...struck(F, 2, 2)], barsOfFour(1))).toEqual(['0-2 C I', '2-4 F IV']);
    expect(said([...struck(C, 0, 1), ...struck(F, 1, 1), ...struck(G, 2, 1), ...struck(Am, 3, 1)], barsOfFour(1))).toEqual([
      '0-1 C I',
      '1-2 F IV',
      '2-3 G V',
      '3-4 Am vi',
    ]);
    // Three beats: cut after the first, or after the second.
    expect(said([...struck(C, 0, 1), ...struck(G, 1, 2)], barsOfFour(1, 3))).toEqual(['0-1 C I', '1-3 G V']);
    expect(said([...struck(C, 0, 2), ...struck(G, 2, 1)], barsOfFour(1, 3))).toEqual(['0-2 C I', '2-3 G V']);
    // Four, changing on the last beat or the second.
    expect(said([...struck(C, 0, 3), ...struck(G, 3, 1)], barsOfFour(1))).toEqual(['0-3 C I', '3-4 G V']);
    expect(said([...struck(C, 0, 1), ...struck(G, 1, 3)], barsOfFour(1))).toEqual(['0-1 C I', '1-4 G V']);
  });

  it('keeps a bar whole that an arpeggio passes through a beat at a time', () => {
    // C, E, G and C again, a beat each: no beat a chord, the bar C.
    const arpeggio = [C4, C4 + 4, C4 + 7, C4 + 12].map((midi, beat) => ({ midi, fromMs: beat * BEAT_MS, untilMs: (beat + 1) * BEAT_MS }));
    expect(said(arpeggio, barsOfFour(1))).toEqual(['0-4 C I']);
  });

  it('does not cut a bar the whole of which is a chord for a half that is only a melody', () => {
    // A minor broken through the bar under a melody passing over it; the
    // second half's notes alone make no chord.
    const notes: NoteSounding[] = [
      { midi: C4 - 3, fromMs: 0, untilMs: 4 * BEAT_MS },
      ...struck([C4, C4 + 4], 0, 2),
      { midi: C4 + 11, fromMs: 2 * BEAT_MS, untilMs: 3 * BEAT_MS },
      { midi: C4 + 12, fromMs: 3 * BEAT_MS, untilMs: 4 * BEAT_MS },
    ];
    expect(said(notes, barsOfFour(1))).toEqual(['0-4 Am vi ≈']);
  });

  it('names nothing where nothing sounds, or nothing makes a chord', () => {
    expect(said([], barsOfFour(2))).toEqual([]);
    expect(said([{ midi: C4, fromMs: 0, untilMs: 8 * BEAT_MS }], barsOfFour(2))).toEqual([]);
    // A rest between two bars of C: two stretches, not one.
    expect(said([...struck(C, 0, 4), ...struck(C, 8, 4)], barsOfFour(3))).toEqual(['0-4 C I', '8-12 C I']);
  });

  it('reads a chord held over a bar line in both bars, and on to the end of a bar it falls silent in', () => {
    // C struck in the middle of the first bar, after F, and let go of in the
    // middle of the second: the second bar is C, to its end.
    expect(said([...struck(F, 0, 2), ...struck(C, 2, 4)], barsOfFour(2))).toEqual(['0-2 F IV', '2-8 C I']);
    // Held only a moment into the next bar, under G there, it is the G that
    // bar mostly is - mostly, for the moment of C.
    expect(said([...struck(C, 0, 4.5), ...struck(G, 4.5, 3.5)], barsOfFour(2))).toEqual(['0-4 C I', '4-8 G V ≈']);
  });

  it('cuts a bar after a chord held into it only once the chord is held there long enough to be heard as one', () => {
    // C held an eighth of a beat at a time further into the second bar, and
    // G from where it is let go of, for its last beat at least: the bar is G
    // until C is a chord of its own there, and then C and G - and never the
    // other way back.
    const cutAt: number[] = [];
    for (let eighths = 0; eighths <= 24; eighths += 1) {
      const into = eighths / 8;
      const bar = theChordsAlongTheBars([...struck(C, 0, 4 + into), ...struck(G, 4 + into, 4 - into)], barsOfFour(2), []).filter(
        (chord) => chord.fromMs >= 4 * BEAT_MS || chord.untilMs > 4 * BEAT_MS,
      );
      const names = bar.map((chord) => chord.name);
      expect(names.at(-1), `held ${String(into)} beats in`).toBe('G');
      if (names.length > 1 && names[0] === 'C') {
        cutAt.push(into);
      }
    }
    // Cut from somewhere between half a beat and two, and from there on.
    const from = cutAt[0] ?? Number.POSITIVE_INFINITY;
    expect(from).toBeGreaterThan(0.5);
    expect(from).toBeLessThanOrEqual(2);
    expect(cutAt).toEqual(Array.from({ length: cutAt.length }, (_, at) => from + at / 8));
  });

  it('says the degree in the key the music is in there, and spells as it spells', () => {
    const keys = [
      { fromMs: 0, fifths: 0, scale: 'major' as const },
      { fromMs: 4 * BEAT_MS, fifths: 1, scale: 'major' as const },
    ];
    // G in C major is V; in G major, I. D is V there.
    expect(said([...struck(G, 0, 4), ...struck(G, 4, 4), ...struck([C4 + 2, C4 + 6, C4 + 9], 8, 4)], barsOfFour(3), keys)).toEqual([
      '0-4 G V',
      '4-8 G I',
      '8-12 D V',
    ]);
    // A flat key spells its black keys flat, where a chart spells D flat C sharp.
    expect(said(struck([C4 + 1, C4 + 5, C4 + 8], 0, 4), barsOfFour(1), [{ fromMs: 0, fifths: -4, scale: 'major' }])).toEqual([
      '0-4 D♭ IV',
    ]);
    // Before the first key it is in that one; with none, C major.
    const fromTheSecondBeat = [
      { fromMs: BEAT_MS, fifths: 1, scale: 'major' as const },
      { fromMs: 8 * BEAT_MS, fifths: 2, scale: 'major' as const },
    ];
    expect(said(struck(G, 0, 4), barsOfFour(1), fromTheSecondBeat)).toEqual(['0-4 G I']);
    expect(said(struck(G, 0, 4), barsOfFour(1))).toEqual(['0-4 G V']);
    // Each carries the key it is read in, which its degree is in.
    expect(theChordsAlongTheBars([...struck(G, 0, 4), ...struck(G, 4, 4), ...struck([C4 + 2, C4 + 6, C4 + 9], 8, 4)], barsOfFour(3), keys).map((chord) => chord.key)).toEqual([
      { fifths: 0, scale: 'major' },
      { fifths: 1, scale: 'major' },
      { fifths: 1, scale: 'major' },
    ]);
    expect(theChordsAlongTheBars(struck(G, 0, 4), barsOfFour(1), []).map((chord) => chord.key)).toEqual([{ fifths: 0, scale: 'major' }]);
  });

  it('says a stretch is exactly a chord only where every part of it is', () => {
    // A minor under a melody, then struck alone; and the other way about.
    const underAMelody = (bar: number): NoteSounding[] => [
      { midi: C4 - 3, fromMs: 4 * bar * BEAT_MS, untilMs: 4 * (bar + 1) * BEAT_MS },
      ...struck([C4, C4 + 4], 4 * bar, 4),
      { midi: C4 + 11, fromMs: 4 * bar * BEAT_MS, untilMs: (4 * bar + 1) * BEAT_MS },
    ];
    expect(said([...underAMelody(0), ...struck(Am, 4, 4)], barsOfFour(2))).toEqual(['0-8 Am vi ≈']);
    expect(said([...struck(Am, 0, 4), ...underAMelody(1)], barsOfFour(2))).toEqual(['0-8 Am vi ≈']);
  });
});

describe('the notes of each bar', () => {
  it('puts a note in every bar it sounds in, one held over a bar line in both, and one ending where a bar begins in the bar before only', () => {
    const bars: BarOfBeats[] = [0, 1_000, 2_000].map((fromMs) => ({ beatsMs: [fromMs, fromMs + 500], untilMs: fromMs + 1_000 }));
    const notes: NoteSounding[] = [
      { midi: 60, fromMs: 0, untilMs: 1_000 },
      { midi: 62, fromMs: 900, untilMs: 2_100 },
      { midi: 64, fromMs: 2_500, untilMs: 2_600 },
      { midi: 65, fromMs: 3_000, untilMs: 3_500 },
    ];
    expect(theNotesOfEachBar(notes, bars).map((bar) => bar.map((note) => note.midi))).toEqual([[60, 62], [62], [62, 64]]);
  });
});

describe('the notes as the pedal holds them', () => {
  const bars: BarOfBeats[] = [0, 3_000, 6_000].map((fromMs) => ({ beatsMs: [fromMs, fromMs + 1_000, fromMs + 2_000], untilMs: fromMs + 3_000 }));
  const until = (notes: readonly NoteSounding[]): number[] => notes.map((note) => note.untilMs);

  it('rings a note let go of with the pedal down until the pedal comes up or its key is struck again, and under a pedal never let up to its bar end', () => {
    const notes: NoteSounding[] = [
      // Let go of before the pedal goes down: as it was.
      { midi: 48, fromMs: 0, untilMs: 400 },
      // Under the pedal, which comes up at 2 s.
      { midi: 52, fromMs: 600, untilMs: 900 },
      // Struck again at 1.5 s, before the pedal comes up.
      { midi: 55, fromMs: 600, untilMs: 900 },
      { midi: 55, fromMs: 1_500, untilMs: 1_800 },
      // Held past the pedal coming up: as it was.
      { midi: 60, fromMs: 600, untilMs: 2_500 },
      // Under a pedal let up in the next bar: over the bar line, to where it comes up.
      { midi: 62, fromMs: 2_700, untilMs: 2_900 },
      // Held over the bar line into a pedal never let up: as it was, not cut back to its bar.
      { midi: 67, fromMs: 5_500, untilMs: 6_500 },
      // Under that pedal: to the end of its bar, and no further.
      { midi: 64, fromMs: 6_200, untilMs: 6_400 },
    ];
    const pedal = [
      { downAtMs: 500, upAtMs: 2_000 },
      { downAtMs: 2_600, upAtMs: 4_500 },
      { downAtMs: 6_100, upAtMs: null },
    ];
    expect(until(theNotesThePedalHolds(notes, pedal, bars))).toEqual([400, 2_000, 1_500, 2_000, 2_500, 4_500, 6_500, 9_000]);
    // Let up only as the music ends, it was never let up: the note under it in the second bar rings to that bar's end.
    expect(until(theNotesThePedalHolds(notes, [pedal[0] ?? { downAtMs: 500, upAtMs: 2_000 }, { downAtMs: 2_600, upAtMs: 6_500 }], bars))[5]).toBe(3_000);
    // With no pedal, the notes themselves.
    expect(theNotesThePedalHolds(notes, [], bars)).toBe(notes);
  });

  it('hears a broken chord in the bass with the pedal down as its chord, its third and all', () => {
    // A quaver of G♯ and of B, under E and B held.
    const broken: NoteSounding[] = [
      { midi: 56, fromMs: 0, untilMs: 500 },
      { midi: 59, fromMs: 500, untilMs: 1_000 },
      { midi: 64, fromMs: 1_000, untilMs: 3_000 },
      { midi: 71, fromMs: 0, untilMs: 3_000 },
    ];
    const inAMinor = [{ fromMs: Number.NEGATIVE_INFINITY, fifths: 0, scale: 'minor' as const }];
    const heard = (notes: readonly NoteSounding[]): string[] => theChordsAlongTheBars(notes, bars.slice(0, 1), inAMinor).map((chord) => `${chord.name} ${chord.numeral}`);
    expect(heard(broken)).toEqual(['E5 V5']);
    expect(heard(theNotesThePedalHolds(broken, [{ downAtMs: 0, upAtMs: null }], bars))).toEqual(['E/G♯ V']);
  });
});
