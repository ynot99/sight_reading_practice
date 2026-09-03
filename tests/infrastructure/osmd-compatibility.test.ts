// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { RhythmProfileRegistry } from '../../src/domain/generation/RhythmProfile.js';

import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { bar, p, tiedExercise, twoBarExercise } from '../support/fixtures.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry, validateExercise } from '../../src/domain/model/Exercise.js';

const RHYTHMS = new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES);

/** Both hands active, so a rhythm profile shows up on two staves at once. */
const WIDE_PRESET = (() => {
  const preset = BUILT_IN_PRESETS.find((candidate) => candidate.id === 'wide-grand-staff');
  if (preset === undefined) {
    throw new Error('expected the wide grand staff preset');
  }
  return preset;
})();

const serializer = new MusicXmlSerializer();

function createDisplay(): OpenSheetMusicDisplay {
  const container = document.createElement('div');
  document.body.append(container);
  return new OpenSheetMusicDisplay(container, {
    backend: 'svg',
    autoResize: false,
    drawTitle: false,
    drawingParameters: 'compact',
  });
}

/**
 * Contract test between our serializer and the real engraver.
 *
 * Rendering needs layout APIs jsdom does not provide, so this stops at
 * parsing - which is exactly the step that would break if the MusicXML we
 * emit were malformed, mis-ordered or missing required elements.
 */
describe('OSMD accepts the MusicXML we produce', () => {
  beforeAll(() => {
    // OSMD probes for a canvas to measure text; jsdom has no 2D context and
    // logs a warning for every probe. Parsing does not need one.
    HTMLCanvasElement.prototype.getContext = () => null;
  });

  it('parses a grand staff exercise into the expected structure', async () => {
    const exercise = twoBarExercise();
    const osmd = createDisplay();

    await osmd.load(serializer.serialize(exercise));

    const sheet = osmd.Sheet;
    expect(sheet).toBeDefined();
    expect(sheet.SourceMeasures).toHaveLength(2);
    expect(sheet.Instruments[0]?.Staves).toHaveLength(2);
  });

  it('agrees with our timeline on where the cursor can stop', async () => {
    const exercise = twoBarExercise();
    const timeline = buildTimeline(exercise);
    const osmd = createDisplay();

    await osmd.load(serializer.serialize(exercise));

    // Walk OSMD's own iterator and count the positions it visits.
    const iterator = osmd.Sheet.MusicPartManager.getIterator();
    let positions = 0;
    let guard = 100;
    while (!iterator.EndReached && guard > 0) {
      guard -= 1;
      positions += 1;
      iterator.moveToNext();
    }

    expect(positions).toBe(timeline.length);
  });

  it('parses every built-in preset', async () => {
    for (const preset of BUILT_IN_PRESETS) {
      const exercise = preset.generator.generate({
        measures: 4,
        timeSignature: new TimeSignature(3, 4),
        key: KeySignature.major(-2),
        tempoBpm: 80,
        rhythm: RHYTHMS.get(preset.defaults.rhythmProfileId),
        seed: 777,
      });
      const osmd = createDisplay();

      await osmd.load(serializer.serialize(exercise));

      expect(osmd.Sheet.SourceMeasures).toHaveLength(4);
    }
  });

  it('reads a triplet as three positions in the time of two', async () => {
    const preset = BUILT_IN_PRESETS[1];
    const profile = BUILT_IN_RHYTHM_PROFILES.find((candidate) => candidate.id === 'triplets');
    if (preset === undefined || profile === undefined) {
      throw new Error('expected a preset and the triplets profile');
    }
    const exercise = preset.generator.generate({
      measures: 4,
      timeSignature: new TimeSignature(4, 4),
      key: KeySignature.major(0),
      tempoBpm: 60,
      rhythm: profile,
      seed: 11,
    });
    // The seed has to actually produce some, or this proves nothing.
    const hasTriplets = exercise.staves.some((staff) =>
      staff.measures.some((measure) => measure.entries.some((entry) => entry.duration.isTuplet)),
    );
    expect(hasTriplets).toBe(true);

    const timeline = buildTimeline(exercise);
    const osmd = createDisplay();

    await osmd.load(serializer.serialize(exercise));

    const iterator = osmd.Sheet.MusicPartManager.getIterator();
    let positions = 0;
    let guard = timeline.length * 4 + 10;
    while (!iterator.EndReached && guard > 0) {
      guard -= 1;
      positions += 1;
      iterator.moveToNext();
    }

    expect(positions).toBe(timeline.length);
  });

  it('draws the short values imported music is written in', async () => {
    // A bar of a piano arrangement: down to sixty-fourths, which the reader's
    // scores are full of. The engraver has to stop on every one of them, or
    // the marker and the timeline disagree for the rest of the piece.
    const base = twoBarExercise();
    const [treble, bass] = base.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('expected two staves');
    }
    const run = bar(
      noteEntry(p('C4'), Duration.HALF),
      noteEntry(p('D4'), Duration.QUARTER),
      noteEntry(p('E4'), Duration.EIGHTH),
      noteEntry(p('F4'), Duration.SIXTEENTH),
      noteEntry(p('G4'), Duration.of('32nd')),
      noteEntry(p('A4'), Duration.of('64th')),
      noteEntry(p('B4'), Duration.of('64th')),
    );
    const exercise = {
      ...base,
      staves: [
        { ...treble, measures: [run, ...treble.measures.slice(1)] },
        bass,
      ],
    };
    validateExercise(exercise);

    const timeline = buildTimeline(exercise);
    const osmd = createDisplay();

    await osmd.load(serializer.serialize(exercise));

    const iterator = osmd.Sheet.MusicPartManager.getIterator();
    let positions = 0;
    let guard = timeline.length * 4 + 10;
    while (!iterator.EndReached && guard > 0) {
      guard -= 1;
      positions += 1;
      iterator.moveToNext();
    }

    expect(positions).toBe(timeline.length);
  });

  it('draws seven in the time of four, and stops on each of them', async () => {
    // The engraver has to accept the bracket we write for a septuplet, and
    // count the same seven positions inside it. Anything less and the marker
    // walks out of step with the music for the rest of the piece.
    const base = twoBarExercise();
    const [treble, bass] = base.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('expected two staves');
    }
    const seven = Duration.of('16th', 0, { actual: 7, normal: 4 });
    const run = bar(
      ...['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'].map((name) => noteEntry(p(name), seven)),
      noteEntry(p('C5'), Duration.DOTTED_HALF),
    );
    const exercise = {
      ...base,
      staves: [{ ...treble, measures: [run, ...treble.measures.slice(1)] }, bass],
    };
    validateExercise(exercise);

    const timeline = buildTimeline(exercise);
    const osmd = createDisplay();

    await osmd.load(serializer.serialize(exercise));

    const iterator = osmd.Sheet.MusicPartManager.getIterator();
    let positions = 0;
    let guard = timeline.length * 4 + 10;
    while (!iterator.EndReached && guard > 0) {
      guard -= 1;
      positions += 1;
      iterator.moveToNext();
    }

    expect(positions).toBe(timeline.length);
  });

  it('agrees on the cursor across a change of metre', async () => {
    // A metre change moves the bar lines, and the engraver draws them from
    // the `<time>` we write while the timeline counts them from the metre we
    // recorded. If those two ever part company the marker walks out of step
    // for the rest of the piece - which is the whole reason the change is
    // carried rather than ignored.
    const base = twoBarExercise();
    const [treble, bass] = base.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('expected two staves');
    }
    const exercise = {
      ...base,
      timeChanges: [{ measureIndex: 1, timeSignature: new TimeSignature(3, 4) }],
      staves: [
        {
          ...treble,
          measures: [
            bar(noteEntry(p('C4'), Duration.WHOLE)),
            bar(
              noteEntry(p('D4'), Duration.QUARTER),
              noteEntry(p('E4'), Duration.QUARTER),
              noteEntry(p('F4'), Duration.QUARTER),
            ),
          ],
        },
        {
          ...bass,
          measures: [
            bar(noteEntry(p('C3'), Duration.WHOLE)),
            bar(noteEntry(p('G2'), Duration.DOTTED_HALF)),
          ],
        },
      ],
    };
    validateExercise(exercise);

    const timeline = buildTimeline(exercise);
    const osmd = createDisplay();

    await osmd.load(serializer.serialize(exercise));

    expect(osmd.Sheet.SourceMeasures).toHaveLength(2);
    const iterator = osmd.Sheet.MusicPartManager.getIterator();
    let positions = 0;
    let guard = timeline.length * 4 + 10;
    while (!iterator.EndReached && guard > 0) {
      guard -= 1;
      positions += 1;
      iterator.moveToNext();
    }

    expect(positions).toBe(timeline.length);
  });

  it('agrees on the cursor when two voices share a staff', async () => {
    // An imported score puts an inner line on the same staff as the melody.
    // The engraver stops wherever either voice moves, and so must we.
    const base = twoBarExercise();
    const [treble, bass] = base.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('expected two staves');
    }
    const exercise = {
      ...base,
      staves: [treble, { ...bass, staffNumber: 1, voice: 3, clef: 'treble' as const }, bass],
    };
    const timeline = buildTimeline(exercise);
    const osmd = createDisplay();

    await osmd.load(serializer.serialize(exercise));

    expect(osmd.Sheet.Instruments[0]?.Staves).toHaveLength(2);
    const iterator = osmd.Sheet.MusicPartManager.getIterator();
    let positions = 0;
    let guard = timeline.length * 4 + 10;
    while (!iterator.EndReached && guard > 0) {
      guard -= 1;
      positions += 1;
      iterator.moveToNext();
    }

    expect(positions).toBe(timeline.length);
  });

  it('reads a tie as one held note and still stops the cursor on it', async () => {
    const exercise = tiedExercise();
    const timeline = buildTimeline(exercise);
    const osmd = createDisplay();

    await osmd.load(serializer.serialize(exercise));

    const iterator = osmd.Sheet.MusicPartManager.getIterator();
    let positions = 0;
    let guard = 50;
    while (!iterator.EndReached && guard > 0) {
      guard -= 1;
      positions += 1;
      iterator.moveToNext();
    }

    // The engraver draws the continuation, so it has a cursor position; the
    // timeline has the step but demands nothing new there. Those are different
    // facts, and both derivations have to agree on the first one.
    expect(positions).toBe(timeline.length);
    expect(timeline.steps.at(-1)?.expectedMidi).toEqual([Pitch.parse('C3').midi]);
  });

  // Sixteenths halve the distance between onsets and bring beaming with them,
  // which is exactly where the printed page and the matcher's timeline could
  // start disagreeing about how many places there are to stop.
  it('agrees on cursor positions under every rhythm profile', async () => {
    for (const profile of BUILT_IN_RHYTHM_PROFILES) {
      for (const timeSignature of [new TimeSignature(4, 4), new TimeSignature(6, 8)]) {
        const exercise = WIDE_PRESET.generator.generate({
          measures: 2,
          timeSignature,
          key: KeySignature.major(0),
          tempoBpm: 60,
          rhythm: profile,
          seed: 31,
        });
        const timeline = buildTimeline(exercise);
        const osmd = createDisplay();

        await osmd.load(serializer.serialize(exercise));

        const iterator = osmd.Sheet.MusicPartManager.getIterator();
        let positions = 0;
        let guard = timeline.length * 4 + 10;
        while (!iterator.EndReached && guard > 0) {
          guard -= 1;
          positions += 1;
          iterator.moveToNext();
        }

        expect({ profile: profile.id, time: timeSignature.toString(), positions }).toEqual({
          profile: profile.id,
          time: timeSignature.toString(),
          positions: timeline.length,
        });
      }
    }
  });
});
