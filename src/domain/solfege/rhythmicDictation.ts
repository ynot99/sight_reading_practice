import { Duration } from '../model/Duration.js';
import type { Exercise, MusicalEntry } from '../model/Exercise.js';
import { noteEntry } from '../model/Exercise.js';
import { KeySignature } from '../model/KeySignature.js';
import { Pitch } from '../model/Pitch.js';
import { TimeSignature } from '../model/TimeSignature.js';
import { createRng } from '../generation/Rng.js';
import { intoBars } from './bars.js';

/** How hard a rhythm is: crotchets, quavers and minims, or dotted notes and semiquavers too. */
export const RHYTHM_LEVELS = ['simple', 'dotted'] as const;
export type RhythmLevel = (typeof RHYTHM_LEVELS)[number];

/** A round of rhythms to be tapped back: how hard, and the seed that writes them. */
export interface RhythmsAsked {
  readonly level: RhythmLevel;
  readonly seed: number;
}

/** How many bars a round asks, each a rhythm of its own. */
export const RHYTHMS_IN_A_ROUND = 8;

/** What a round of rhythmic dictation is filed as. */
export const RHYTHMIC_DICTATION_ID = 'solfege.rhythmic-dictation';

/** What a round of rhythms to read is filed as. */
export const RHYTHMS_READ_ID = 'solfege.rhythms-read';

const TIME = new TimeSignature(4, 4);

/** The one key every note is written on, the middle line of the treble staff: any key is the answer. */
const ON = Pitch.parse('B4');

const Q = Duration.QUARTER;
const E = Duration.EIGHTH;
const S = Duration.SIXTEENTH;

/**
 * The figures a rhythm is made of, each filling whole beats: the plain
 * ones a first dictation uses, and the dotted and semiquaver ones after it.
 */
const FIGURES: Readonly<Record<RhythmLevel, readonly (readonly Duration[])[]>> = {
  simple: [[Q], [E, E], [Duration.HALF]],
  dotted: [[Q], [E, E], [Duration.HALF], [Duration.DOTTED_QUARTER, E], [S, S, E], [E, S, S], [S, S, S, S], [Duration.DOTTED_HALF]],
};

/**
 * A round of rhythmic dictation: a bar for each rhythm, all on one key,
 * heard and then tapped back in time - on any key, from the downbeat the
 * reader gives, the click keeping the pulse - its first note given and the
 * rest kept off the page until each is played, then shown (see
 * `Exercise.playedBack`). Each bar is made of figures filling whole beats,
 * so it reads as it is counted: beamed by the beat.
 *
 * The same request is the same round; another seed, another.
 */
export function theRhythmicDictation(asked: RhythmsAsked): Exercise {
  const written = theRhythmsWritten(asked);
  return {
    ...written,
    playedBack: { questions: written.staves.flatMap((staff) => staff.measures).map((_, at) => ({ from: at, until: at + 1 })), heard: true, keyFirst: false, inTime: 'each-bar' },
  };
}

/**
 * A round of rhythms to read: the bars a round of dictation would ask, on
 * the page from the first, and tapped through in time - on any key, after a
 * bar counted in, the pulse going on without waiting at a bar line - as a
 * rhythm is read at sight. Nothing is heard and nothing kept off the page.
 *
 * The same request is the same round; another seed, another.
 */
export function theRhythmsRead(asked: RhythmsAsked): Exercise {
  return {
    ...theRhythmsWritten(asked),
    id: `${RHYTHMS_READ_ID}:${String(asked.seed)}`,
    title: 'Rhythm reading',
    metadata: { generatorId: RHYTHMS_READ_ID, seed: asked.seed },
    playedBack: { questions: [], heard: false, keyFirst: false, inTime: 'throughout' },
  };
}

/** The bars of a round of rhythms, all on one key, and the music around them. */
function theRhythmsWritten(asked: RhythmsAsked): Exercise {
  const rng = createRng(asked.seed);
  const beatTicks = Q.ticks;
  const bars = Array.from({ length: RHYTHMS_IN_A_ROUND }, () => {
    const notes: MusicalEntry[] = [];
    let beats = TIME.beats;
    while (beats > 0) {
      const fits = FIGURES[asked.level].filter((figure) => figure.reduce((sum, each) => sum + each.ticks, 0) / beatTicks <= beats);
      const figure = rng.pick(fits);
      notes.push(...figure.map((length) => noteEntry(ON, length)));
      beats -= figure.reduce((sum, each) => sum + each.ticks, 0) / beatTicks;
    }
    return notes;
  });
  return {
    id: `${RHYTHMIC_DICTATION_ID}:${String(asked.seed)}`,
    title: 'Rhythmic dictation',
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
    tempoBpm: 72,
    firstBarNumber: 1,
    barLabels: [],
    staves: [{ staffNumber: 1, voice: 1, clef: 'treble', clefChanges: [], measures: bars.flatMap((bar) => intoBars(bar, TIME)) }],
    metadata: { generatorId: RHYTHMIC_DICTATION_ID, seed: asked.seed },
  };
}
