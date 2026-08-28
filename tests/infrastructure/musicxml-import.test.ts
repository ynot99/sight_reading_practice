// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { DomMusicXmlImporter } from '../../src/infrastructure/notation/DomMusicXmlImporter.js';
import { DomainError } from '../../src/shared/errors.js';
import { tiedExercise, twoBarExercise } from '../support/fixtures.js';

const importer = new DomMusicXmlImporter();
const serializer = new MusicXmlSerializer();

/** What the player is asked to press, step by step. */
function demands(exercise: Parameters<typeof buildTimeline>[0]): readonly (readonly number[])[] {
  return buildTimeline(exercise).steps.map((step) => step.expectedMidi);
}

describe('reading back what we wrote', () => {
  it('recovers the same music, with nothing to report', () => {
    const original = twoBarExercise();
    const { exercise, warnings } = importer.read(serializer.serialize(original));

    expect(warnings).toEqual([]);
    expect(exercise.key.equals(original.key)).toBe(true);
    expect(exercise.timeSignature.toString()).toBe(original.timeSignature.toString());
    expect(exercise.staves.map((staff) => staff.clef)).toEqual(['treble', 'bass']);
    expect(demands(exercise)).toEqual(demands(original));
  });

  it('recovers a note held across the bar line', () => {
    const original = tiedExercise();
    const { exercise } = importer.read(serializer.serialize(original));

    // The held E4 is still not demanded twice on the far side of the tie.
    expect(demands(exercise)).toEqual(demands(original));
    expect(buildTimeline(exercise).noteCount).toBe(buildTimeline(original).noteCount);
  });

  it('recovers every built-in preset under every rhythm, triplets included', () => {
    for (const preset of BUILT_IN_PRESETS) {
      for (const profile of BUILT_IN_RHYTHM_PROFILES) {
        const original = preset.generator.generate({
          measures: 3,
          timeSignature: new TimeSignature(4, 4),
          key: KeySignature.major(-2),
          tempoBpm: 84,
          rhythm: profile,
          seed: 9,
        });
        const { exercise } = importer.read(serializer.serialize(original));
        const where = `${preset.id}/${profile.id}`;

        expect({ where, tempo: exercise.tempoBpm }).toEqual({ where, tempo: 84 });
        expect({ where, demands: demands(exercise) }).toEqual({
          where,
          demands: demands(original),
        });
      }
    }
  });
});

describe('files the reader cannot use', () => {
  it('says so when the file is not XML at all', () => {
    expect(() => importer.read('this is not a score')).toThrow(DomainError);
  });

  it('says so when it is XML but not a score', () => {
    expect(() => importer.read('<shopping><item>milk</item></shopping>')).toThrow(
      /does not look like a MusicXML score/,
    );
  });

  it('names timewise files, which MuseScore does not export by default', () => {
    expect(() => importer.read('<score-timewise><measure/></score-timewise>')).toThrow(
      /partwise/,
    );
  });
});

/** A one-part score in the shape other programs actually write. */
function scoreXml(body: string, divisions = 24): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Something Borrowed</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>${divisions}</divisions>
        <key><fifths>1</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      ${body}
    </measure>
  </part>
</score-partwise>`;
}

function note(step: string, octave: number, duration: number, type: string, extra = ''): string {
  return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
    `<duration>${duration}</duration><voice>1</voice><type>${type}</type>${extra}</note>`;
}

describe('files written by other programs', () => {
  it('rescales whatever divisions the file chose', () => {
    // 24 divisions to the quarter, so a quarter note says 24 and must come
    // back as our 480.
    const { exercise } = importer.read(
      scoreXml(
        note('C', 4, 24, 'quarter') +
          note('D', 4, 24, 'quarter') +
          note('E', 4, 48, 'half'),
      ),
    );

    const durations = exercise.staves[0]?.measures[0]?.entries.map((entry) => entry.duration.ticks);
    expect(durations).toEqual([480, 480, 960]);
    expect(exercise.title).toBe('Something Borrowed');
    expect(exercise.key.fifths).toBe(1);
  });

  it('keeps the first voice of a staff and says it dropped the rest', () => {
    const second =
      '<backup><duration>96</duration></backup>' +
      '<note><pitch><step>G</step><octave>3</octave></pitch><duration>96</duration>' +
      '<voice>2</voice><type>whole</type></note>';
    const { exercise, warnings } = importer.read(
      scoreXml(note('C', 4, 96, 'whole') + second),
    );

    expect(exercise.staves).toHaveLength(1);
    expect(warnings.map((warning) => warning.kind)).toContain('extra-voices');
    expect(exercise.staves[0]?.measures[0]?.entries).toHaveLength(1);
  });

  it('drops grace notes rather than mistaking them for beats', () => {
    const grace =
      '<note><grace/><pitch><step>B</step><octave>3</octave></pitch>' +
      '<voice>1</voice><type>eighth</type></note>';
    const { exercise, warnings } = importer.read(
      scoreXml(grace + note('C', 4, 96, 'whole')),
    );

    expect(warnings.map((warning) => warning.kind)).toContain('grace-notes');
    // The bar still adds up, which a grace note counted as time would break.
    expect(exercise.staves[0]?.measures[0]?.entries).toHaveLength(1);
  });

  it('pads a short bar at the front, so the downbeats that follow stay put', () => {
    const { exercise, warnings } = importer.read(scoreXml(note('G', 4, 24, 'quarter')));

    expect(warnings.map((warning) => warning.kind)).toContain('padded-measure');
    const entries = exercise.staves[0]?.measures[0]?.entries ?? [];
    expect(entries.at(-1)?.kind).toBe('note');
    expect(entries.slice(0, -1).every((entry) => entry.kind === 'rest')).toBe(true);
  });

  it('refuses a value it cannot write, and says which', () => {
    // A 32nd note is 3 divisions here, and this trainer reads down to
    // sixteenths.
    expect(() => importer.read(scoreXml(note('C', 4, 3, '32nd') + note('D', 4, 93, 'whole')))).toThrow(
      /sixteenth notes/,
    );
  });
});
