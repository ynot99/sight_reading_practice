import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import type { Exercise, Measure } from '../../src/domain/model/Exercise.js';
import {
  noteEntry,
  restEntry,
  tiedNoteEntry,
  validateExercise,
} from '../../src/domain/model/Exercise.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { ExerciseValidationError } from '../../src/shared/errors.js';
import { bar, p, tiedExercise, twoBarExercise } from '../support/fixtures.js';

/** Replaces the treble staff, leaving the bass alone. */
function withTreble(exercise: Exercise, measures: readonly Measure[]): Exercise {
  const [treble, ...rest] = exercise.staves;
  if (treble === undefined) {
    throw new Error('expected a treble staff');
  }
  return { ...exercise, staves: [{ ...treble, measures }, ...rest] };
}

describe('a note held across the bar line', () => {
  const exercise = tiedExercise();

  it('is a valid exercise', () => {
    expect(() => validateExercise(exercise)).not.toThrow();
  });

  it('is demanded once, not twice', () => {
    const timeline = buildTimeline(exercise);
    const downbeatOfBarTwo = timeline.steps.find(
      (step) => step.onsetTicks === Duration.WHOLE.ticks,
    );

    expect(downbeatOfBarTwo).toBeDefined();
    // The E4 is still sounding from bar one: the only key left to press is the
    // left hand's.
    expect(downbeatOfBarTwo?.expectedMidi).toEqual([p('C3').midi]);
  });

  it('still stops the cursor where the tie continues', () => {
    // The engraver draws a notehead there, so the timeline must have a step
    // there too - the two walk in lockstep or the cursor drifts.
    const timeline = buildTimeline(exercise);
    const q = Duration.QUARTER.ticks;
    expect(timeline.steps.map((step) => step.onsetTicks)).toEqual([0, q * 2, q * 3, q * 4]);
  });

  it('reports how long the key is actually held', () => {
    const timeline = buildTimeline(exercise);
    const struck = timeline.steps.find(
      (step) => step.onsetTicks === Duration.DOTTED_HALF.ticks,
    );
    const held = struck?.notes.find((note) => note.midi === p('E4').midi);

    // A quarter tied to a whole: one press lasting five beats, not one.
    expect(held?.durationTicks).toBe(Duration.QUARTER.ticks + Duration.WHOLE.ticks);
  });

  it('counts as one note in the total', () => {
    // Four presses: C4, C3, D4, E4, then C3 again on the second downbeat.
    expect(buildTimeline(exercise).noteCount).toBe(5);
  });
});

describe('ties that lead nowhere', () => {
  it('rejects a tie running off the end of the staff', () => {
    const broken = withTreble(twoBarExercise(), [
      bar(noteEntry(p('C4'), Duration.WHOLE)),
      bar(tiedNoteEntry(p('C4'), Duration.WHOLE)),
    ]);
    expect(() => validateExercise(broken)).toThrow(/runs off the end/);
  });

  it('rejects a tie into a rest', () => {
    const broken = withTreble(twoBarExercise(), [
      bar(tiedNoteEntry(p('C4'), Duration.HALF), restEntry(Duration.HALF)),
      bar(noteEntry(p('G4'), Duration.WHOLE)),
    ]);
    expect(() => validateExercise(broken)).toThrow(/leads into a rest/);
  });

  it('rejects a tie into a different pitch', () => {
    const broken = withTreble(twoBarExercise(), [
      bar(tiedNoteEntry(p('C4'), Duration.HALF), noteEntry(p('D4'), Duration.HALF)),
      bar(noteEntry(p('G4'), Duration.WHOLE)),
    ]);
    expect(() => validateExercise(broken)).toThrow(/does not contain it/);
  });

  it('rejects a tie on a pitch the entry never plays', () => {
    const broken = withTreble(twoBarExercise(), [
      bar(noteEntry(p('C4'), Duration.HALF, [p('G5').midi]), noteEntry(p('C4'), Duration.HALF)),
      bar(noteEntry(p('G4'), Duration.WHOLE)),
    ]);
    expect(() => validateExercise(broken)).toThrow(ExerciseValidationError);
    expect(() => validateExercise(broken)).toThrow(/does not play/);
  });

  it('allows one note of a chord to be tied and not the others', () => {
    const chord = [p('C4'), p('E4')];
    const partly = withTreble(twoBarExercise(), [
      bar(noteEntry(chord, Duration.HALF, [p('C4').midi]), noteEntry(chord, Duration.HALF)),
      bar(noteEntry(p('G4'), Duration.WHOLE)),
    ]);
    expect(() => validateExercise(partly)).not.toThrow();

    const timeline = buildTimeline(partly);
    const second = timeline.steps.find((step) => step.onsetTicks === Duration.HALF.ticks);
    // The C is still held; the E has to be struck again.
    expect(second?.expectedMidi).toEqual([p('E4').midi]);
  });
});

describe('ties in the printed score', () => {
  const xml = new MusicXmlSerializer({ includeMetronomeMark: false }).serialize(tiedExercise());

  it('writes the sound and the slur as MusicXML keeps them: apart', () => {
    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<tie type="stop"/>');
    expect(xml).toContain('<tied type="start"/>');
    expect(xml).toContain('<tied type="stop"/>');
  });

  it('puts the tie where the schema expects it', () => {
    // Right after the duration, and the slur inside notations after the staff.
    expect(xml).toMatch(
      new RegExp(`<duration>${Duration.QUARTER.ticks}</duration>\\s*<tie type="start"/>`),
    );
    expect(xml).toMatch(/<staff>1<\/staff>\s*<notations>/);
  });

  it('does not reprint an accidental on the far side of the tie', () => {
    const withSharp = withTreble(tiedExercise(), [
      bar(
        noteEntry(p('C4'), Duration.HALF),
        noteEntry(p('D4'), Duration.QUARTER),
        // F sharp in C major: the first one has to be spelled out.
        noteEntry(p('F#4'), Duration.QUARTER, [p('F#4').midi]),
      ),
      bar(noteEntry(p('F#4'), Duration.WHOLE)),
    ]);
    const printed = new MusicXmlSerializer({ includeMetronomeMark: false }).serialize(withSharp);

    // Once, on the note that was struck - never again on the continuation,
    // which crosses a bar line and would otherwise look like a new sharp.
    expect([...printed.matchAll(/<accidental>sharp<\/accidental>/g)]).toHaveLength(1);
  });
});
