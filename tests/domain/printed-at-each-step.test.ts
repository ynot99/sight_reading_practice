import { describe, expect, it } from 'vitest';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { barId, measureIndexOfBar, printedAtEachStep } from '../../src/domain/notation/printedIds.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry } from '../../src/domain/model/Exercise.js';
import {
  arpeggiatedExercise,
  beamedSixteenths,
  longExercise,
  p,
  partialVoiceExercise,
  tiedExercise,
  twoBarExercise,
} from '../support/fixtures.js';

const serializer = new MusicXmlSerializer();

describe('a bar’s name, read back', () => {
  it('gives the bar it was made from', () => {
    expect(measureIndexOfBar(barId(0))).toBe(0);
    expect(measureIndexOfBar(barId(1341))).toBe(1341);
  });

  it('is nothing for a name that is not a bar’s, or only begins like one', () => {
    // The engraver names the things it draws itself - `m1xu7gi1` is a staff
    // of one of its pages - and one that only begins like a bar's is not one.
    expect(measureIndexOfBar('n3-1-0-0')).toBeNull();
    expect(measureIndexOfBar('m3x')).toBeNull();
    expect(measureIndexOfBar('xm3')).toBeNull();
    expect(measureIndexOfBar('m')).toBeNull();
  });
});

describe('where on the page each step is', () => {
  it('names every note and rest that begins at a step, in every voice, with its bar', () => {
    //   treble: C4 D4 E4 F4 | G4 (whole)
    //   bass:   C3 (whole)  | [G2 D3] (half) + half rest
    const steps = printedAtEachStep(buildTimeline(twoBarExercise()));

    expect(steps.map((step) => [step.barId, step.printed.map((here) => here.id)])).toEqual([
      ['m0', ['n0-1-0-0', 'n0-2-0-0']],
      ['m0', ['n0-1-1-0']],
      ['m0', ['n0-1-2-0']],
      ['m0', ['n0-1-3-0']],
      ['m1', ['n1-1-0-0', 'n1-2-0-0', 'n1-2-0-1']],
      ['m1', ['r1-2-1']],
    ]);
  });

  it('says which staff each is on, which key a note is and where it is written, and that a rest is none', () => {
    const steps = printedAtEachStep(buildTimeline(twoBarExercise()));

    expect(steps[0]?.printed).toEqual([
      { id: 'n0-1-0-0', staffNumber: 1, midi: 60, diatonicIndex: 28 },
      { id: 'n0-2-0-0', staffNumber: 2, midi: 48, diatonicIndex: 21 },
    ]);
    expect(steps[5]?.printed).toEqual([{ id: 'r1-2-1', staffNumber: 2, midi: null, diatonicIndex: null }]);
  });

  it('tells two spellings of one key apart by where they are written', () => {
    // F sharp and G flat: one key, two places on the staff.
    const sharp = printedAtEachStep(
      buildTimeline(partialVoiceExercise([noteEntry(p('F#4'), Duration.WHOLE)])),
    );
    const flat = printedAtEachStep(
      buildTimeline(partialVoiceExercise([noteEntry(p('Gb4'), Duration.WHOLE)])),
    );
    const written = (steps: typeof sharp): number | null | undefined =>
      steps[0]?.printed.find((here) => here.staffNumber === 1 && here.id.startsWith('n0-2'))?.diatonicIndex;

    expect(written(sharp)).toBe(31);
    expect(written(flat)).toBe(32);
  });

  it('gives a note tied over from the step before its place at this one', () => {
    //   treble: C4 (half) D4 E4 ~ | E4 (whole)
    //   bass:   C3 (whole)        | C3 (whole)
    // Nobody plays the E4 again at bar two, and it is drawn there: the marker
    // stands on what is drawn, not only on what is pressed.
    const timeline = buildTimeline(tiedExercise());
    const downbeat = timeline.steps.findIndex((step) => step.measureIndex === 1);

    expect(timeline.at(downbeat)?.expectedMidi).toEqual([48]);
    expect(printedAtEachStep(timeline)[downbeat]?.printed).toEqual([
      { id: 'n1-1-0-0', staffNumber: 1, midi: 64, diatonicIndex: 30 },
      { id: 'n1-2-0-0', staffNumber: 2, midi: 48, diatonicIndex: 21 },
    ]);
  });

  it('leaves out a rest nobody draws, which has no place on the page', () => {
    //   voice 2: (silence) G3 (silence), under C4 D4 E4 F4
    const steps = printedAtEachStep(buildTimeline(partialVoiceExercise()));

    expect(steps[0]?.printed.map((here) => here.id)).toEqual(['n0-1-0-0']);
    expect(steps.flatMap((step) => step.printed.map((here) => here.id))).not.toContain('r0-2-0');
  });

  it('is one entry for every step of the timeline', () => {
    const timeline = buildTimeline(longExercise({ bars: 12 }));

    expect(printedAtEachStep(timeline)).toHaveLength(timeline.length);
  });
});

describe('the names a step is given, against the page that is printed', () => {
  // The whole point: these are the names the engraver will be asked for, so
  // every one has to be on the printed page, and everything drawn on it has
  // to belong to a step. Checked across the fixtures that print the most
  // different things.
  const fixtures: readonly [string, Exercise][] = [
    ['two bars', twoBarExercise()],
    ['a tie', tiedExercise()],
    ['a voice that comes and goes', partialVoiceExercise()],
    ['rolled chords', arpeggiatedExercise()],
    ['beamed sixteenths', beamedSixteenths()],
    ['many bars', longExercise({ bars: 16 })],
  ];

  it.each(fixtures)('finds every name of %s on its printed page', (_name, exercise) => {
    const printed = serializer.serialize(exercise);
    const named = printedAtEachStep(buildTimeline(exercise)).flatMap((step) => [
      step.barId,
      ...step.printed.map((here) => here.id),
    ]);

    for (const id of named) {
      expect(printed).toContain(`id="${id}"`);
    }
  });

  it.each(fixtures)('gives everything drawn on the page of %s to a step', (_name, exercise) => {
    const printed = serializer.serialize(exercise);
    // Every note and drawn rest - not a grace, which is no step's, and not a
    // rest nobody draws.
    const drawn = [...printed.matchAll(/<note id="([nr][^"]+)"(?! print-object="no")/g)].map(
      (found) => found[1],
    );
    const named = new Set(
      printedAtEachStep(buildTimeline(exercise)).flatMap((step) => step.printed.map((here) => here.id)),
    );

    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.filter((id) => id !== undefined && !named.has(id))).toEqual([]);
  });
});
