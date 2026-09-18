import { describe, expect, it } from 'vitest';
import { GatheredNotes, type ScheduledNote } from '../../src/application/GatheredNotes.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry, type Exercise } from '../../src/domain/model/Exercise.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { bar, longExercise, MIDI, p, twoBarExercise } from '../support/fixtures.js';

function everyNote(gathered: GatheredNotes): ScheduledNote[] {
  const notes: ScheduledNote[] = [];
  for (let index = 0; ; index += 1) {
    const note = gathered.at(index);
    if (note === null) {
      return notes;
    }
    notes.push(note);
  }
}

/**
 * A rolled chord, and then a note whose ornament leans back into it.
 *
 * At sixty to the crotchet the roll's notes sound at 0, 38 and 76 ms. The
 * grace on the second beat is written as a half note, and squeezed into the
 * room between the two beats it starts where the roll does - so it sounds in
 * front of the roll's last two notes, though it belongs to the step after.
 */
function anOrnamentLeaningIntoARoll(): Exercise {
  const base = twoBarExercise({ tempoBpm: 60 });
  const [treble] = base.staves;
  if (treble === undefined) {
    throw new Error('the fixture has a treble staff');
  }
  return {
    ...base,
    staves: [
      {
        ...treble,
        measures: [
          bar(
            noteEntry([p('C4'), p('E4'), p('G4')], Duration.QUARTER, [], [], null, true),
            noteEntry(p('F4'), Duration.QUARTER, [], [], null, false, {
              graces: [{ pitches: [p('D4')], duration: Duration.HALF, slashed: false }],
            }),
            noteEntry(p('G4'), Duration.QUARTER),
            noteEntry(p('A4'), Duration.QUARTER),
          ),
        ],
      },
    ],
  };
}

describe('the notes of a performance, gathered as it reaches them', () => {
  it('gathers no further than it is asked', () => {
    // Asked for all at once they were the wait before the music: on the
    // longest score he owns, gathering every note to the end before the first
    // could sound was most of what was left of starting.
    const timeline = buildTimeline(longExercise({ bars: 200 }));
    const gathered = new GatheredNotes(timeline, null, 0, Number.POSITIVE_INFINITY);

    gathered.at(0);

    // A note at the very moment the step before the last one sounded waits for
    // one more step, in case an ornament leans back exactly that far.
    expect(gathered.stepsGathered).toBeLessThanOrEqual(3);
    expect(timeline.steps.length).toBeGreaterThan(100);
  });

  it('hands an ornament out before the notes of the roll it leans into', () => {
    // The order the whole list was sorted into, kept though the list is no
    // longer whole: a note is handed out only once nothing still to gather
    // could sound in front of it.
    const timeline = buildTimeline(anOrnamentLeaningIntoARoll());

    const notes = everyNote(new GatheredNotes(timeline, 1, 0, Number.POSITIVE_INFINITY));

    const moments = notes.map((note) => note.atMs);
    expect(moments).toEqual([...moments].sort((left, right) => left - right));
    const grace = notes.findIndex((note) => note.midi === p('D4').midi);
    const lastOfTheRoll = notes.findIndex((note) => note.midi === MIDI.G4);
    expect(grace).toBeGreaterThanOrEqual(0);
    expect(grace).toBeLessThan(lastOfTheRoll);
  });

  it('begins where the performance does, without gathering what comes before', () => {
    const timeline = buildTimeline(longExercise({ bars: 40 }));
    const from = timeline.steps[60];
    if (from === undefined) {
      throw new Error('the fixture is long enough');
    }
    const gathered = new GatheredNotes(timeline, null, from.onsetTicks, Number.POSITIVE_INFINITY);

    const first = gathered.at(0);

    expect(first?.atMs).toBe(0);
    expect(from.notes.map((note) => note.midi)).toContain(first?.midi);
    expect(gathered.stepsGathered).toBeLessThanOrEqual(3);
  });

  it('counts every note when asked how many there are', () => {
    const timeline = buildTimeline(longExercise({ bars: 12 }));
    const gathered = new GatheredNotes(timeline, null, 0, Number.POSITIVE_INFINITY);

    expect(gathered.length).toBe(
      everyNote(new GatheredNotes(timeline, null, 0, Number.POSITIVE_INFINITY)).length,
    );
    expect(gathered.length).toBe(timeline.steps.reduce((sum, step) => sum + step.notes.length, 0));
  });
});
