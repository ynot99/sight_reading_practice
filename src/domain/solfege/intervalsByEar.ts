import { Duration } from '../model/Duration.js';
import type { Exercise, Measure } from '../model/Exercise.js';
import { measureOf, noteEntry } from '../model/Exercise.js';
import { KeySignature } from '../model/KeySignature.js';
import { Pitch } from '../model/Pitch.js';
import { TimeSignature } from '../model/TimeSignature.js';
import { createRng } from '../generation/Rng.js';

/**
 * The intervals within an octave, each by how many semitones it spans and
 * how many letters: a minor third is three semitones over two letters, so
 * above F it is A flat and never G sharp. The one of six is spelled as the
 * augmented fourth, as an interval book lists the tritone.
 */
export const INTERVALS = [
  { semitones: 1, letters: 1, short: 'm2', called: 'minor second' },
  { semitones: 2, letters: 1, short: 'M2', called: 'major second' },
  { semitones: 3, letters: 2, short: 'm3', called: 'minor third' },
  { semitones: 4, letters: 2, short: 'M3', called: 'major third' },
  { semitones: 5, letters: 3, short: 'P4', called: 'perfect fourth' },
  { semitones: 6, letters: 3, short: 'TT', called: 'tritone' },
  { semitones: 7, letters: 4, short: 'P5', called: 'perfect fifth' },
  { semitones: 8, letters: 5, short: 'm6', called: 'minor sixth' },
  { semitones: 9, letters: 5, short: 'M6', called: 'major sixth' },
  { semitones: 10, letters: 6, short: 'm7', called: 'minor seventh' },
  { semitones: 11, letters: 6, short: 'M7', called: 'major seventh' },
  { semitones: 12, letters: 7, short: 'P8', called: 'octave' },
] as const;

/** How the two notes of an interval are heard: the second above the first, below it, or both at once. */
export const INTERVAL_WAYS = ['up', 'down', 'together'] as const;
export type IntervalWay = (typeof INTERVAL_WAYS)[number];

/** A round of intervals asked for: which, how they are heard, and the seed that chooses them. */
export interface IntervalsAsked {
  /** The intervals asked about, by their semitones; any not among `INTERVALS` is left out. */
  readonly semitones: readonly number[];
  readonly way: IntervalWay;
  readonly seed: number;
}

/** How many intervals a round asks: enough to say something, few enough to finish. */
export const QUESTIONS_IN_A_ROUND = 10;

/** What a round of intervals is filed as. */
export const INTERVALS_BY_EAR_ID = 'solfege.intervals-by-ear';

/** A calm pace, so each note of a question is heard for a second. */
const INTERVALS_BPM = 60;

const TIME = new TimeSignature(4, 4);

/**
 * The notes a question may use, the A under middle C to the A two octaves
 * above it: the treble staff and a ledger line or two either side of it,
 * where an interval is heard plainly and read without counting lines.
 */
const LOWEST = Pitch.parse('A3').midi;
const HIGHEST = Pitch.parse('A5').midi;

/**
 * A round of intervals to be found by ear: a bar for each, its first note
 * given and the second heard and then played, above it, below it or with
 * it. Played back by ear, so the second is kept off the page until it is
 * found (see `Exercise.playedBack`); the answer is the very key, in its octave,
 * since from a given note an interval has only one.
 *
 * The same request is the same round; another seed, another.
 */
export function theIntervalsByEar(asked: IntervalsAsked): Exercise {
  const { measures, asking } = theIntervalsWritten(asked);
  return {
    ...asking,
    id: `${INTERVALS_BY_EAR_ID}:${String(asked.seed)}`,
    title: 'Intervals played back',
    metadata: { generatorId: INTERVALS_BY_EAR_ID, seed: asked.seed },
    playedBack: { questions: measures.map((_, at) => ({ from: at, until: at + 1 })), heard: true, keyFirst: false, inTime: false },
  };
}

/** What a round of intervals to be named is filed as. */
export const INTERVALS_BY_NAME_ID = 'solfege.intervals-by-name';

/**
 * A round of intervals to be named: the same bars as a round by ear, read
 * rather than heard, each asking which of the intervals chosen it is. Its
 * choices are those chosen, smallest first - as every one, where none is.
 */
export function theIntervalsNamed(asked: IntervalsAsked): Exercise {
  const { asking, named, given, intervals } = theIntervalsWritten(asked);
  const choices = intervals.map((interval) => interval.short);
  const by = asked.way === 'down' ? -1 : 1;
  // Each as its bar is: the note given, and then the other - or the two together.
  const heardAs = (from: number): Record<string, readonly (readonly number[])[]> =>
    Object.fromEntries(
      intervals.map((interval) => {
        const other = from + by * interval.semitones;
        return [interval.short, [[from], asked.way === 'together' ? [from, other] : [other]]];
      }),
    );
  return {
    ...asking,
    id: `${INTERVALS_BY_NAME_ID}:${String(asked.seed)}`,
    title: 'Intervals by name',
    metadata: { generatorId: INTERVALS_BY_NAME_ID, seed: asked.seed },
    byName: named.map((interval, measureIndex) => ({
      measureIndex,
      parts: [{ asks: 'Interval', choices, answer: interval.short, heardAs: heardAs(given[measureIndex] ?? 0) }],
    })),
  };
}

/** What a round of intervals heard and named is filed as. */
export const INTERVALS_NAMED_BY_EAR_ID = 'solfege.intervals-named-by-ear';

/**
 * A round of intervals to be named by ear: the bars of a round named, heard
 * and kept off the page until each is answered (see `Exercise.namedByEar`),
 * as an interval is first named by ear - its name tapped, which is what it
 * is whichever note it begins on.
 */
export function theIntervalsNamedByEar(asked: IntervalsAsked): Exercise {
  return {
    ...theIntervalsNamed(asked),
    id: `${INTERVALS_NAMED_BY_EAR_ID}:${String(asked.seed)}`,
    title: 'Intervals named by ear',
    metadata: { generatorId: INTERVALS_NAMED_BY_EAR_ID, seed: asked.seed },
    namedByEar: true,
  };
}

type Interval = (typeof INTERVALS)[number];

/**
 * The bars of a round of intervals, one for each, its first note and then
 * the other above it, below it or with it - with the two together, the bar
 * is the note and then the two of them, so a round by ear still has a note
 * to give and a step that is all answer. Every note is spelled as the
 * interval writes it - its letters counted, a third over F an A flat - and
 * the first as often with flats as with sharps. The rest of the exercise
 * around them, and which interval each bar is.
 */
function theIntervalsWritten(asked: IntervalsAsked): {
  readonly measures: readonly Measure[];
  readonly asking: Exercise;
  readonly named: readonly Interval[];
  /** The key each bar begins on. */
  readonly given: readonly number[];
  readonly intervals: readonly Interval[];
} {
  const rng = createRng(asked.seed);
  const chosen = INTERVALS.filter((interval) => asked.semitones.includes(interval.semitones));
  const intervals = chosen.length === 0 ? INTERVALS : chosen;
  const named: Interval[] = [];
  const givens: number[] = [];
  const measures = Array.from({ length: QUESTIONS_IN_A_ROUND }, () => {
    const interval = rng.pick(intervals);
    named.push(interval);
    const down = asked.way === 'down';
    const lowestGiven = down ? LOWEST + interval.semitones : LOWEST;
    const highestGiven = down ? HIGHEST : HIGHEST - interval.semitones;
    const given = Pitch.fromMidi(rng.int(lowestGiven, highestGiven), rng.next() < 0.5);
    givens.push(given.midi);
    const by = down ? -1 : 1;
    const other = Pitch.writtenAt(given.diatonicIndex + by * interval.letters, given.midi + by * interval.semitones);
    return measureOf([
      noteEntry(given, Duration.HALF),
      noteEntry(asked.way === 'together' ? [given, other] : other, Duration.HALF),
    ]);
  });
  const asking: Exercise = {
    id: '',
    title: '',
    key: KeySignature.C_MAJOR,
    keyChanges: [],
    timeChanges: [],
    tempoChanges: [],
    pedalMarks: [],
    dynamicMarks: [],
    tempoWords: [],
    hairpins: [],
    octaveShifts: [],
    timeSignature: TIME,
    tempoBpm: INTERVALS_BPM,
    firstBarNumber: 1,
    barLabels: [],
    staves: [{ staffNumber: 1, voice: 1, clef: 'treble', clefChanges: [], measures }],
    metadata: { generatorId: '', seed: asked.seed },
  };
  return { measures, asking, named, given: givens, intervals };
}
