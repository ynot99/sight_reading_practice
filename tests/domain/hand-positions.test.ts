import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/domain/generation/Rng.js';
import { PatternVoiceGenerator } from '../../src/domain/generation/voices/PatternVoiceGenerator.js';
import { TakingTurnsVoiceGenerator } from '../../src/domain/generation/voices/TakingTurnsVoiceGenerator.js';
import type { IVoiceGenerator, VoiceContext } from '../../src/domain/generation/voices/IVoiceGenerator.js';
import { measureOf, noteEntry, type Measure } from '../../src/domain/model/Exercise.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { steadyProfile } from '../support/rhythm.js';

const COMMON = new TimeSignature(4, 4);

function contextIn(key: KeySignature, overrides: Partial<VoiceContext> = {}): VoiceContext {
  return {
    rng: createRng(5),
    key,
    timeSignature: COMMON,
    measures: 12,
    rhythm: steadyProfile(Duration.QUARTER),
    ...overrides,
  };
}

function pitchesOf(measures: readonly Measure[]): Pitch[] {
  return measures.flatMap((measure) =>
    measure.entries.flatMap((entry) => (entry.kind === 'note' ? [...entry.pitches] : [])),
  );
}

/** The lowest and highest notes written, by name. */
function spanOf(measures: readonly Measure[]): string {
  const pitches = pitchesOf(measures).sort((left, right) => left.diatonicIndex - right.diatonicIndex);
  return `${pitches[0]?.toString() ?? '-'}..${pitches.at(-1)?.toString() ?? '-'}`;
}

describe('five fingers from the tonic', () => {
  // Every figure may walk the whole hand, and sixty notes of scales do.
  const hand = new PatternVoiceGenerator({
    range: { lowest: Pitch.parse('C4'), highest: Pitch.parse('G4') },
    role: 'lead',
    figures: [{ value: 'scale', weight: 1 }],
    maxLeap: 1,
    fiveFingersFromTheTonic: true,
  });

  it('sets the hand on the key, from the first tonic at or above the lowest note', () => {
    expect(spanOf(hand.generate(contextIn(KeySignature.major(0))))).toBe('C4..G4');
    expect(spanOf(hand.generate(contextIn(KeySignature.major(1))))).toBe('G4..D5');
    expect(spanOf(hand.generate(contextIn(KeySignature.minor(-1))))).toBe('D4..A4');
    expect(spanOf(hand.generate(contextIn(KeySignature.major(-2))))).toBe('Bb4..F5');
  });

  it('keeps the range as written where it is not asked to', () => {
    const plain = new PatternVoiceGenerator({
      range: { lowest: Pitch.parse('C4'), highest: Pitch.parse('G4') },
      role: 'lead',
      figures: [{ value: 'scale', weight: 1 }],
      maxLeap: 1,
    });
    expect(spanOf(plain.generate(contextIn(KeySignature.major(1))))).toBe('C4..G4');
  });
});

describe('hands taking turns', () => {
  /** Every bar one held note, tied over into the next. */
  const held: IVoiceGenerator = {
    id: 'voice.held',
    generate: (context) =>
      Array.from({ length: context.measures }, () =>
        measureOf([noteEntry(Pitch.parse('C4'), Duration.WHOLE, [Pitch.parse('C4').midi])]),
      ),
  };

  function playedBars(turn: number, measures: number): boolean[] {
    const voice = new TakingTurnsVoiceGenerator({ voice: held, turn, hands: 2, barsEach: 2 });
    return voice
      .generate(contextIn(KeySignature.major(0), { measures }))
      .map((measure) => measure.entries.some((entry) => entry.kind === 'note'));
  }

  it('plays only in its own turns, two bars each', () => {
    expect(playedBars(0, 6)).toEqual([true, true, false, false, true, true]);
    expect(playedBars(1, 6)).toEqual([false, false, true, true, false, false]);
  });

  it('rests a whole bar where it is the other hand\'s turn', () => {
    const voice = new TakingTurnsVoiceGenerator({ voice: held, turn: 1, hands: 2, barsEach: 2 });
    const [resting] = voice.generate(contextIn(KeySignature.major(0), { measures: 2 }));
    expect(resting?.entries.map((entry) => `${entry.kind}/${entry.duration.type}`)).toEqual(['rest/whole']);
  });

  it('holds nothing over into the other hand\'s turn, and keeps the ties inside its own', () => {
    const voice = new TakingTurnsVoiceGenerator({ voice: held, turn: 0, hands: 2, barsEach: 2 });
    const ties = voice
      .generate(contextIn(KeySignature.major(0), { measures: 6 }))
      .map((measure) => {
        const last = measure.entries.at(-1);
        return last?.kind === 'note' && last.tiedForward.length > 0;
      });
    // Bars 2 and 6 each end a turn; the ties inside a turn stay.
    expect(ties).toEqual([true, false, false, false, true, false]);
  });
});
