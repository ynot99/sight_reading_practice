import { Duration } from '../model/Duration.js';
import type { Exercise, Measure, MusicalEntry, RehearsalMark } from '../model/Exercise.js';
import { measureOf, noteEntry } from '../model/Exercise.js';
import { KeySignature } from '../model/KeySignature.js';
import { Pitch } from '../model/Pitch.js';
import { TimeSignature } from '../model/TimeSignature.js';
import { beamedByTheBeat } from '../generation/beaming.js';
import { theNameOfTheKey, type ScaleName } from '../harmony/scales.js';
import { elementAt } from '../../shared/asserts.js';

/** The scales a scale complex is played in: a major one, or a minor one in each of its three forms. */
export const SCALE_COMPLEX_SCALES = ['major', 'minor', 'harmonicMinor', 'melodicMinor'] as const satisfies readonly ScaleName[];
export type ScaleOfTheComplex = (typeof SCALE_COMPLEX_SCALES)[number];

/** A scale complex asked for: the key's sharps or flats, and its scale. */
export interface ScaleComplexAsked {
  readonly fifths: number;
  readonly scale: ScaleOfTheComplex;
}

/** What a scale complex is filed as, so a reading of one is a reading of that key's. */
export const SCALE_COMPLEX_ID = 'solfege.scale-complex';

/** A walking pace for eighths up and down two octaves, which the reader slows or speeds as the drawer says. */
const SCALE_COMPLEX_BPM = 80;

const TIME = new TimeSignature(4, 4);

/** The parts of a complex, in the order a lesson plays them, each named where it begins. */
const PARTS = ['Scale', 'Arpeggio', 'Chords', 'Cadence'] as const;

/** Steps of a scale up from the tonic, the octave counted on. */
const OCTAVE = 7;

/** The leading note and the sixth: the degrees a minor scale's forms raise. */
const SIXTH = 5;
const SEVENTH = 6;

/**
 * The scale complex of a key, as a music school sets it for every lesson:
 * the scale two octaves up and down, the long arpeggio of the tonic triad,
 * the tonic chord in its three positions up and back, and the cadence
 * tonic - subdominant - dominant - tonic. Both hands throughout, so the key
 * is learned under the fingers rather than read: it is the same exercise
 * every time it is asked for, and none of it is marked with fingering or
 * names, which would take away the work it is for.
 *
 * The hands play the scale and the arpeggio two octaves apart, so neither
 * climbs far off its staff; the chords and the cadence an octave apart, the
 * left hand under them in the cadence playing its roots. The right hand
 * begins on the tonic nearest middle C from the A below it, so no key is
 * pushed high up the treble staff.
 *
 * In minor the scale is played in the form asked for - natural, harmonic
 * with its leading note raised, or melodic with the sixth and seventh
 * raised going up and lowered coming down - and the cadence's dominant is
 * major in every form, as it is in the harmonic minor that harmony is
 * taught in.
 */
export function theScaleComplex(asked: ScaleComplexAsked): Exercise {
  const minor = asked.scale !== 'major';
  const key = minor ? KeySignature.minor(asked.fifths) : KeySignature.major(asked.fifths);
  const right = key.tonicIndexAtOrAbove(Pitch.parse('A3').diatonicIndex);
  // A degree as the key writes it, raised a semitone where the form raises it.
  const at = (tonic: number, step: number, raised: boolean): Pitch => {
    const natural = key.pitchAt(tonic + step);
    return raised ? Pitch.writtenAt(natural.diatonicIndex, natural.midi + 1) : natural;
  };
  const degree = (step: number): number => ((step % OCTAVE) + OCTAVE) % OCTAVE;
  const raisedInTheScale = (step: number, going: 'up' | 'down'): boolean =>
    (asked.scale === 'harmonicMinor' && degree(step) === SEVENTH) ||
    (asked.scale === 'melodicMinor' && going === 'up' && (degree(step) === SIXTH || degree(step) === SEVENTH));
  const theLeadingNote = (step: number): boolean => minor && degree(step) === SEVENTH;

  // Each hand's part, as runs of eighths closed by a held tonic.
  const scale = (tonic: number): MusicalEntry[] => [
    ...Array.from({ length: 2 * OCTAVE + 1 }, (_, step) => noteEntry(at(tonic, step, raisedInTheScale(step, 'up')), Duration.EIGHTH)),
    ...Array.from({ length: 2 * OCTAVE - 1 }, (_, down) => {
      const step = 2 * OCTAVE - 1 - down;
      return noteEntry(at(tonic, step, raisedInTheScale(step, 'down')), Duration.EIGHTH);
    }),
    noteEntry(at(tonic, 0, false), Duration.HALF),
  ];
  const arpeggio = (tonic: number): MusicalEntry[] => [
    ...[0, 2, 4, 7, 9, 11, 14, 11, 9, 7, 4, 2].map((step) => noteEntry(at(tonic, step, false), Duration.EIGHTH)),
    noteEntry(at(tonic, 0, false), Duration.HALF),
  ];
  const chord = (tonic: number, steps: readonly number[], length: Duration): MusicalEntry =>
    noteEntry(
      steps.map((step) => at(tonic, step, theLeadingNote(step))),
      length,
    );
  const positions = (tonic: number): MusicalEntry[] => [
    ...[
      [0, 2, 4],
      [2, 4, 7],
      [4, 7, 9],
      [7, 9, 11],
      [4, 7, 9],
      [2, 4, 7],
    ].map((steps) => chord(tonic, steps, Duration.QUARTER)),
    chord(tonic, [0, 2, 4], Duration.HALF),
  ];
  // The cadence in the hand position a keyboard harmony lesson begins with:
  // the tonic held where it is common, the rest moving by a step.
  const cadence = (tonic: number): MusicalEntry[] =>
    [
      [0, 2, 4],
      [0, 3, 5],
      [-1, 1, 4],
      [0, 2, 4],
    ].map((steps) => chord(tonic, steps, Duration.HALF));
  const roots = (tonic: number): MusicalEntry[] => [0, -4, -3, 0].map((step) => chord(tonic, [step], Duration.HALF));

  const rightHand = [scale(right), arpeggio(right), positions(right), cadence(right)];
  const leftHand = [scale(right - 2 * OCTAVE), arpeggio(right - 2 * OCTAVE), positions(right - OCTAVE), roots(right - OCTAVE)];
  // Each part named over the bar it begins in, as a section of the piece.
  const marks = rightHand.reduce<{ readonly bar: number; readonly named: readonly RehearsalMark[] }>(
    ({ bar, named }, part, index) => ({
      bar: bar + intoBars(part).length,
      named: [...named, { measureIndex: bar, offsetTicks: 0, text: elementAt(PARTS, index) }],
    }),
    { bar: 0, named: [] },
  ).named;
  const named = { fifths: asked.fifths, scale: asked.scale };
  return {
    id: `${SCALE_COMPLEX_ID}:${String(asked.fifths)}:${asked.scale}`,
    title: `${theNameOfTheKey(named)}: scale, arpeggio, chords, cadence`,
    key,
    keyChanges: [],
    timeChanges: [],
    tempoChanges: [],
    pedalMarks: [],
    dynamicMarks: [],
    tempoWords: [],
    hairpins: [],
    octaveShifts: [],
    timeSignature: TIME,
    tempoBpm: SCALE_COMPLEX_BPM,
    firstBarNumber: 1,
    barLabels: [],
    staves: [
      { staffNumber: 1, voice: 1, clef: 'treble', clefChanges: [], measures: rightHand.flatMap(intoBars) },
      { staffNumber: 2, voice: 2, clef: 'bass', clefChanges: [], measures: leftHand.flatMap(intoBars) },
    ],
    rehearsalMarks: marks,
    metadata: { generatorId: SCALE_COMPLEX_ID, seed: 0 },
  };
}

/** A part's entries laid into bars of the metre, each beamed by the beat. */
function intoBars(entries: readonly MusicalEntry[]): Measure[] {
  const bars: MusicalEntry[][] = [[]];
  let filled = 0;
  for (const entry of entries) {
    if (filled === TIME.ticksPerMeasure) {
      bars.push([]);
      filled = 0;
    }
    bars[bars.length - 1]?.push(entry);
    filled += entry.duration.ticks;
  }
  return bars.map((bar) => beamedByTheBeat(measureOf(bar), TIME));
}
