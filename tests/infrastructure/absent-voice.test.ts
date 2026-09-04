// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import { measureTicks, validateExercise } from '../../src/domain/model/Exercise.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { DomScoreImporter } from '../../src/infrastructure/notation/DomScoreImporter.js';

const importer = new DomScoreImporter();
const serializer = new MusicXmlSerializer();

/** One bar of 4/4 at 4 divisions to the quarter, with a second voice in it. */
function bar(secondVoice: string, staves = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time>${staves}
      <clef number="1"><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration>
      <voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      ${secondVoice}
    </measure>
  </part>
</score-partwise>`;
}

const HALF_G4 =
  '<note><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration>' +
  '<voice>2</voice><type>half</type><staff>1</staff></note>';

describe('a voice that is absent for part of a bar', () => {
  it('draws no rest where the writer wrote none', () => {
    // MuseScore ends an inner voice by simply not writing any more of it, and
    // hides the rests it would otherwise need. Filled in with rests, the page
    // counts silence nobody asked for - 313 of them across the reader's own
    // scores, and one cursor stop for each that has no note beside it.
    const { exercise } = importer.read(bar(HALF_G4));
    const inner = exercise.staves[1]?.measures[0]?.entries ?? [];

    expect(inner.map((entry) => entry.kind)).toEqual(['note', 'silence']);
    // Absent, but the bar still adds up: the silence takes its own time.
    expect(measureTicks(exercise.staves[1]?.measures[0] ?? { entries: [] })).toBe(
      Duration.WHOLE.ticks,
    );
    expect(() => validateExercise(exercise)).not.toThrow();

    const printed = serializer.serialize(exercise);
    expect(printed).not.toContain('<rest');
    expect(printed).toContain('<forward>');
  });

  it('does the same for a voice that enters late', () => {
    const { exercise } = importer.read(
      bar(`<forward><duration>8</duration></forward>${HALF_G4}`),
    );

    expect(exercise.staves[1]?.measures[0]?.entries.map((entry) => entry.kind)).toEqual([
      'silence',
      'note',
    ]);
    expect(serializer.serialize(exercise)).not.toContain('<rest');
  });

  it('holds no cursor position where nothing is drawn', () => {
    // The engraver stops where it draws. A rest we invented would be a stop
    // the reader is held at with a blank stave in front of them.
    const silent = buildTimeline(importer.read(bar(HALF_G4)).exercise);
    expect(silent.steps.map((step) => step.onsetTicks)).toEqual([0]);

    const drawn = buildTimeline(
      importer.read(
        bar(`${HALF_G4}<note><rest/><duration>8</duration><voice>2</voice><type>half</type><staff>1</staff></note>`),
      ).exercise,
    );
    // The writer asked for this one, so it keeps its position.
    expect(drawn.steps.map((step) => step.onsetTicks)).toEqual([0, Duration.HALF.ticks]);
  });

  it('gives the rest back when the staff itself would be left blank', () => {
    // The bass has one voice and it stops halfway. Nothing else is drawing
    // there, so that half bar is a hole rather than an absence, and one voice
    // has to carry a rest through it.
    const twoStaves = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>
      <clef number="1"><sign>G</sign><line>2</line></clef>
      <clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration>
      <voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>8</duration>
      <voice>2</voice><type>half</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const { exercise, warnings } = importer.read(twoStaves);
    const bass = exercise.staves[1]?.measures[0]?.entries ?? [];

    expect(bass.map((entry) => entry.kind)).toEqual(['note', 'rest']);
    expect(warnings.map((warning) => warning.kind)).toContain('padded-measure');
    expect(() => validateExercise(exercise)).not.toThrow();
  });

  it('draws rests only through the part of a bar nothing covers', () => {
    // In bar two the melody covers the first three beats and the inner line
    // the middle two. So the fourth beat is a hole and the first is not, and
    // only the fourth gets a rest - carried by one voice, not by both.
    const threeBeats =
      '<note><pitch><step>C</step><octave>5</octave></pitch><duration>12</duration>' +
      '<voice>1</voice><type>half</type><dot/><staff>1</staff></note>';
    const inner =
      '<forward><duration>4</duration></forward>' +
      '<note><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration>' +
      '<voice>2</voice><type>half</type><staff>1</staff></note>';
    const { exercise } = importer.read(
      `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time>
      <clef number="1"><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration>
      <voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration>
      <voice>2</voice><type>whole</type><staff>1</staff></note>
    </measure>
    <measure number="2">
      ${threeBeats}
      <backup><duration>12</duration></backup>
      ${inner}
    </measure>
  </part>
</score-partwise>`,
    );

    // The melody is the first voice on the staff, so it carries the rest.
    expect(exercise.staves[0]?.measures[1]?.entries.map((entry) => entry.kind)).toEqual([
      'note',
      'rest',
    ]);
    // The inner line keeps both its absences: something is drawn either side.
    expect(exercise.staves[1]?.measures[1]?.entries.map((entry) => entry.kind)).toEqual([
      'silence',
      'note',
      'silence',
    ]);
    expect(() => validateExercise(exercise)).not.toThrow();
  });

  it('reads a first bar that everyone is short in as a pickup', () => {
    // Both voices stop after three beats, so the bar is an anacrusis and its
    // notes belong at the end of it - anything else moves every downbeat that
    // follows. One voice being short there is not that, which is the previous
    // test.
    const { exercise } = importer.read(
      `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1" implicit="yes">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time>
      <clef number="1"><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration>
      <voice>1</voice><type>quarter</type><staff>1</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>16</duration>
      <voice>1</voice><type>whole</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`,
    );

    const pickup = exercise.staves[0]?.measures[0]?.entries ?? [];
    expect(pickup.map((entry) => entry.kind)).toEqual(['rest', 'note']);
    expect(pickup.at(-1)?.duration.ticks).toBe(Duration.QUARTER.ticks);
  });
});
