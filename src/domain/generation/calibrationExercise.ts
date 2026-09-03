import { Duration } from '../model/Duration.js';
import type { Exercise } from '../model/Exercise.js';
import { measureOf, noteEntry } from '../model/Exercise.js';
import { KeySignature } from '../model/KeySignature.js';
import { Pitch } from '../model/Pitch.js';
import { TimeSignature } from '../model/TimeSignature.js';

/** Beats to measure over: enough that the average means something. */
const BARS = 4;

/**
 * One note, on every beat, and nothing else to think about.
 *
 * For measuring how long a press takes to arrive, and shaped entirely by
 * that: the same pitch throughout so there is nothing to read, one hand so
 * there is nothing to coordinate, and quarter notes at a walking pace so
 * there is no hurry. Whatever is left between the click and the press is the
 * journey - the keyboard's scan, the relay, the network, the tablet waking -
 * because the reader has been given nothing else to get wrong.
 *
 * Sixteen of them, because an average is only as good as the number of
 * things averaged: the run has to pin the tendency down well enough to tell
 * it from the reader's own unevenness.
 */
export function calibrationExercise(tempoBpm = 80): Exercise {
  const middleC = Pitch.parse('C4');
  const bar = () =>
    measureOf([
      noteEntry(middleC, Duration.QUARTER),
      noteEntry(middleC, Duration.QUARTER),
      noteEntry(middleC, Duration.QUARTER),
      noteEntry(middleC, Duration.QUARTER),
    ]);

  return {
    id: 'calibration',
    title: 'Measuring the delay',
    key: KeySignature.major(0),
    keyChanges: [],
    timeChanges: [],
    pedalMarks: [],
    timeSignature: new TimeSignature(4, 4),
    tempoBpm,
    firstBarNumber: 1,
    staves: [
      {
        staffNumber: 1,
        voice: 1,
        clef: 'treble',
        clefChanges: [],
        measures: Array.from({ length: BARS }, bar),
      },
    ],
    metadata: { generatorId: 'calibration', seed: 0 },
  };
}
