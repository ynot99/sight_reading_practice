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
import { twoBarExercise } from '../support/fixtures.js';

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
