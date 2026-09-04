import { Duration } from '../../src/domain/model/Duration.js';
import type { Exercise, Measure, MusicalEntry } from '../../src/domain/model/Exercise.js';
import { measureOf, noteEntry, restEntry, silenceEntry } from '../../src/domain/model/Exercise.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';

/** Shorthand for `Pitch.parse`, to keep fixtures readable. */
export function p(name: string): Pitch {
  return Pitch.parse(name);
}

export function bar(...entries: MusicalEntry[]): Measure {
  return measureOf(entries);
}

export interface ExerciseOverrides {
  readonly id?: string;
  readonly title?: string;
  readonly key?: KeySignature;
  readonly timeSignature?: TimeSignature;
  readonly tempoBpm?: number;
}

/**
 * Two bars of 4/4 that exercise every structural feature the trainer cares
 * about: a melody, a sustained note under it, a chord and a rest.
 *
 *   treble: C4 D4 E4 F4 | G4 (whole)
 *   bass:   C3 (whole)  | [G2 D3] (half) + half rest
 */
export function twoBarExercise(overrides: ExerciseOverrides = {}): Exercise {
  return {
    id: overrides.id ?? 'fixture-two-bar',
    title: overrides.title ?? 'Two bar fixture',
    key: overrides.key ?? KeySignature.major(0),
    keyChanges: [],
    timeChanges: [],
    tempoChanges: [],
    pedalMarks: [],
    timeSignature: overrides.timeSignature ?? new TimeSignature(4, 4),
    tempoBpm: overrides.tempoBpm ?? 60,
    firstBarNumber: 1,
    metadata: { generatorId: 'fixture', seed: 1 },
    staves: [
      {
        staffNumber: 1,
        voice: 1,
        clef: 'treble',
        clefChanges: [],
        measures: [
          bar(
            noteEntry(p('C4'), Duration.QUARTER),
            noteEntry(p('D4'), Duration.QUARTER),
            noteEntry(p('E4'), Duration.QUARTER),
            noteEntry(p('F4'), Duration.QUARTER),
          ),
          bar(noteEntry(p('G4'), Duration.WHOLE)),
        ],
      },
      {
        staffNumber: 2,
        voice: 2,
        clef: 'bass',
        clefChanges: [],
        measures: [
          bar(noteEntry(p('C3'), Duration.WHOLE)),
          bar(noteEntry([p('G2'), p('D3')], Duration.HALF), restEntry(Duration.HALF)),
        ],
      },
    ],
  };
}

/**
 * One bar of 4/4 holding a chord the writer marked to be rolled.
 *
 *   treble: [C4 E4 G4] (whole, arpeggiated)
 *   bass:   [C3 G3]    (whole, arpeggiated)
 *
 * Written across both staves on purpose: a roll notated that way is one
 * gesture from the lowest note to the highest, not two rolls at once.
 */
/**
 * As many plain bars as asked for, for anything that is about *which* bars.
 *
 * A passage needs room on both sides of it to be widened and narrowed, and
 * two bars is not room.
 */
export function longExercise(
  overrides: ExerciseOverrides & { readonly bars?: number } = {},
): Exercise {
  const count = overrides.bars ?? 8;
  return {
    id: overrides.id ?? 'fixture-long',
    title: overrides.title ?? 'Long fixture',
    key: overrides.key ?? KeySignature.major(0),
    keyChanges: [],
    timeChanges: [],
    tempoChanges: [],
    pedalMarks: [],
    timeSignature: overrides.timeSignature ?? new TimeSignature(4, 4),
    tempoBpm: overrides.tempoBpm ?? 60,
    firstBarNumber: 1,
    metadata: { generatorId: 'fixture', seed: 1 },
    staves: [
      {
        staffNumber: 1,
        voice: 1,
        clef: 'treble',
        clefChanges: [],
        measures: Array.from({ length: count }, () =>
          bar(
            noteEntry(p('C4'), Duration.QUARTER),
            noteEntry(p('D4'), Duration.QUARTER),
            noteEntry(p('E4'), Duration.QUARTER),
            noteEntry(p('F4'), Duration.QUARTER),
          ),
        ),
      },
    ],
  };
}

export function arpeggiatedExercise(overrides: ExerciseOverrides = {}): Exercise {
  return {
    id: overrides.id ?? 'fixture-arpeggiated',
    title: overrides.title ?? 'Arpeggiated fixture',
    key: overrides.key ?? KeySignature.major(0),
    keyChanges: [],
    timeChanges: [],
    tempoChanges: [],
    pedalMarks: [],
    timeSignature: overrides.timeSignature ?? new TimeSignature(4, 4),
    tempoBpm: overrides.tempoBpm ?? 60,
    firstBarNumber: 1,
    metadata: { generatorId: 'fixture', seed: 1 },
    staves: [
      {
        staffNumber: 1,
        voice: 1,
        clef: 'treble',
        clefChanges: [],
        measures: [
          bar(noteEntry([p('C4'), p('E4'), p('G4')], Duration.WHOLE, [], [], null, true)),
        ],
      },
      {
        staffNumber: 2,
        voice: 2,
        clef: 'bass',
        clefChanges: [],
        measures: [bar(noteEntry([p('C3'), p('G3')], Duration.WHOLE, [], [], null, true))],
      },
    ],
  };
}

/**
 * Two beamed groups of sixteenths, treble only.
 *
 *   C4 D4 E4 F4 | G4 A4 B4 C5   - four to a beam, two beams to a group
 *
 * Beams belong to a *group* of notes rather than to one, so this is what a
 * page-emptying feature has to be measured against: fade the notes and the
 * beams are what is left floating over the gap.
 */
export function beamedSixteenths(overrides: ExerciseOverrides = {}): Exercise {
  const beamed = (name: string, at: 'begin' | 'continue' | 'end'): MusicalEntry =>
    noteEntry(p(name), Duration.SIXTEENTH, [], [
      { level: 1, type: at },
      { level: 2, type: at },
    ]);
  return {
    id: overrides.id ?? 'fixture-beamed-sixteenths',
    title: overrides.title ?? 'Beamed sixteenths',
    key: overrides.key ?? KeySignature.major(0),
    keyChanges: [],
    timeChanges: [],
    tempoChanges: [],
    pedalMarks: [],
    timeSignature: overrides.timeSignature ?? new TimeSignature(2, 4),
    tempoBpm: overrides.tempoBpm ?? 60,
    firstBarNumber: 1,
    metadata: { generatorId: 'fixture', seed: 1 },
    staves: [
      {
        staffNumber: 1,
        voice: 1,
        clef: 'treble',
        clefChanges: [],
        measures: [
          bar(
            beamed('C4', 'begin'),
            beamed('D4', 'continue'),
            beamed('E4', 'continue'),
            beamed('F4', 'end'),
            beamed('G4', 'begin'),
            beamed('A4', 'continue'),
            beamed('B4', 'continue'),
            beamed('C5', 'end'),
          ),
        ],
      },
    ],
  };
}

/** One bar of 4/4, treble only, four quarter notes: the simplest useful case. */
export function singleBarExercise(overrides: ExerciseOverrides = {}): Exercise {
  return {
    id: overrides.id ?? 'fixture-single-bar',
    title: overrides.title ?? 'Single bar fixture',
    key: overrides.key ?? KeySignature.major(0),
    keyChanges: [],
    timeChanges: [],
    tempoChanges: [],
    pedalMarks: [],
    timeSignature: overrides.timeSignature ?? new TimeSignature(4, 4),
    tempoBpm: overrides.tempoBpm ?? 60,
    firstBarNumber: 1,
    metadata: { generatorId: 'fixture', seed: 2 },
    staves: [
      {
        staffNumber: 1,
        voice: 1,
        clef: 'treble',
        clefChanges: [],
        measures: [
          bar(
            noteEntry(p('C4'), Duration.QUARTER),
            noteEntry(p('D4'), Duration.QUARTER),
            noteEntry(p('E4'), Duration.QUARTER),
            noteEntry(p('F4'), Duration.QUARTER),
          ),
        ],
      },
    ],
  };
}

/** MIDI numbers of the fixture pitches, for readable expectations. */
/**
 * One bar of 6/8: two dotted-quarter beats, each filled with three eighths.
 *
 * Exists so that compound time can be exercised without pretending a bar of
 * 4/4 is one - the whole point of the pulse arithmetic is that the two count
 * differently.
 */
export function compoundBarExercise(overrides: ExerciseOverrides = {}): Exercise {
  const melody = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4'].map((name) =>
    noteEntry(p(name), Duration.EIGHTH),
  );
  return {
    id: overrides.id ?? 'fixture-compound',
    title: overrides.title ?? 'Compound fixture',
    key: overrides.key ?? KeySignature.major(0),
    keyChanges: [],
    timeChanges: [],
    tempoChanges: [],
    pedalMarks: [],
    timeSignature: overrides.timeSignature ?? new TimeSignature(6, 8),
    tempoBpm: overrides.tempoBpm ?? 60,
    firstBarNumber: 1,
    metadata: { generatorId: 'fixture', seed: 2 },
    staves: [
      { staffNumber: 1, voice: 1, clef: 'treble', clefChanges: [], measures: [bar(...melody)] },
      {
        staffNumber: 2,
        voice: 2,
        clef: 'bass',
        clefChanges: [],
        measures: [
          bar(
            noteEntry(p('C3'), Duration.QUARTER),
            restEntry(Duration.QUARTER),
            restEntry(Duration.QUARTER),
          ),
        ],
      },
    ],
  };
}

/**
 * Two bars of 4/4 with a note held across the bar line.
 *
 *   treble: C4 (half) D4 E4 ~ | E4 (whole)
 *   bass:   C3 (whole)        | C3 (whole)
 *
 * The tied E4 is struck once and held, so the downbeat of bar two demands the
 * left hand's C3 and nothing else - which is the whole point of the tie and
 * the one thing a timeline can get wrong about it.
 */
export function tiedExercise(overrides: ExerciseOverrides = {}): Exercise {
  const held = p('E4');
  return {
    id: overrides.id ?? 'fixture-tied',
    title: overrides.title ?? 'Tied fixture',
    key: overrides.key ?? KeySignature.major(0),
    keyChanges: [],
    timeChanges: [],
    tempoChanges: [],
    pedalMarks: [],
    timeSignature: overrides.timeSignature ?? new TimeSignature(4, 4),
    tempoBpm: overrides.tempoBpm ?? 60,
    firstBarNumber: 1,
    metadata: { generatorId: 'fixture', seed: 3 },
    staves: [
      {
        staffNumber: 1,
        voice: 1,
        clef: 'treble',
        clefChanges: [],
        measures: [
          bar(
            noteEntry(p('C4'), Duration.HALF),
            noteEntry(p('D4'), Duration.QUARTER),
            noteEntry(held, Duration.QUARTER, [held.midi]),
          ),
          bar(noteEntry(held, Duration.WHOLE)),
        ],
      },
      {
        staffNumber: 2,
        voice: 2,
        clef: 'bass',
        clefChanges: [],
        measures: [
          bar(noteEntry(p('C3'), Duration.WHOLE)),
          bar(noteEntry(p('C3'), Duration.WHOLE)),
        ],
      },
    ],
  };
}

/**
 * One bar of 4/4 where two voices share a staff and the lower one comes and
 * goes - the shape that made rests appear where nobody wrote any.
 *
 *   voice 1: C4 D4 E4 F4 (quarters, all through)
 *   voice 2: (silent) G3 (half) (silent)
 */
export function partialVoiceExercise(
  entries: readonly MusicalEntry[] = [
    silenceEntry(Duration.QUARTER),
    noteEntry(p('G3'), Duration.HALF),
    silenceEntry(Duration.QUARTER),
  ],
): Exercise {
  return {
    id: 'fixture-partial-voice',
    title: 'Partial voice fixture',
    key: KeySignature.major(0),
    keyChanges: [],
    timeChanges: [],
    tempoChanges: [],
    pedalMarks: [],
    timeSignature: new TimeSignature(4, 4),
    tempoBpm: 60,
    firstBarNumber: 1,
    metadata: { generatorId: 'fixture', seed: 1 },
    staves: [
      {
        staffNumber: 1,
        voice: 1,
        clef: 'treble',
        clefChanges: [],
        measures: [
          bar(
            noteEntry(p('C4'), Duration.QUARTER),
            noteEntry(p('D4'), Duration.QUARTER),
            noteEntry(p('E4'), Duration.QUARTER),
            noteEntry(p('F4'), Duration.QUARTER),
          ),
        ],
      },
      {
        staffNumber: 1,
        voice: 2,
        clef: 'treble',
        clefChanges: [],
        measures: [bar(...entries)],
      },
    ],
  };
}

export const MIDI = {
  G2: p('G2').midi,
  C3: p('C3').midi,
  D3: p('D3').midi,
  G3: p('G3').midi,
  C4: p('C4').midi,
  D4: p('D4').midi,
  E4: p('E4').midi,
  F4: p('F4').midi,
  G4: p('G4').midi,
  C5: p('C5').midi,
  F5: p('F5').midi,
} as const;
