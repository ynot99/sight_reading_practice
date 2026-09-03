// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import {
  measureCount,
  measureTicks,
  noteEntry,
  restEntry,
  timeAtMeasure,
  validateExercise,
} from '../../src/domain/model/Exercise.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { DomScoreImporter } from '../../src/infrastructure/notation/DomScoreImporter.js';
import { looksZipped } from '../../src/infrastructure/notation/zip.js';
import { DomainError } from '../../src/shared/errors.js';
import { tiedExercise, twoBarExercise } from '../support/fixtures.js';

const importer = new DomScoreImporter();
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
    // 24 divisions to the quarter, so a quarter note says 24 there and has
    // to come back as a quarter in ours, whatever ours happens to be.
    const { exercise } = importer.read(
      scoreXml(
        note('C', 4, 24, 'quarter') +
          note('D', 4, 24, 'quarter') +
          note('E', 4, 48, 'half'),
      ),
    );

    const durations = exercise.staves[0]?.measures[0]?.entries.map((entry) => entry.duration.ticks);
    const q = Duration.QUARTER.ticks;
    expect(durations).toEqual([q, q, q * 2]);
    expect(exercise.title).toBe('Something Borrowed');
    expect(exercise.key.fifths).toBe(1);
  });

  it('counts bars from wherever the file says it starts', () => {
    // A movement exported on its own still numbers its bars against the work
    // it belongs to. Renumbering to 1 would have the reader looking for bar 3
    // of something the score they are holding calls bar 42.
    const { exercise } = importer.read(
      scoreXml(note('C', 4, 96, 'whole')).replace('measure number="1"', 'measure number="40"'),
    );

    expect(exercise.firstBarNumber).toBe(40);
  });

  it('falls back to bar one when the number is not one', () => {
    // Repeated bars are numbered "X1" and a pickup is often "0". Neither is a
    // bar number a reader counts from.
    const { exercise } = importer.read(
      scoreXml(note('C', 4, 96, 'whole')).replace('measure number="1"', 'measure number="0"'),
    );

    expect(exercise.firstBarNumber).toBe(1);
  });

  it('keeps each voice of a staff as its own line', () => {
    const second =
      '<backup><duration>96</duration></backup>' +
      '<note><pitch><step>G</step><octave>3</octave></pitch><duration>96</duration>' +
      '<voice>2</voice><type>whole</type></note>';
    const { exercise, warnings } = importer.read(scoreXml(note('C', 4, 96, 'whole') + second));

    expect(warnings.map((warning) => warning.kind)).toContain('extra-voices');
    // Two parts, one staff: that is what a second voice is.
    expect(exercise.staves).toHaveLength(2);
    expect(exercise.staves.map((staff) => staff.staffNumber)).toEqual([1, 1]);
    expect(exercise.staves.map((staff) => staff.voice)).toEqual([1, 2]);
    // Both notes are struck together, which is all the player cares about.
    expect(buildTimeline(exercise).steps.map((step) => step.expectedMidi)).toEqual([[55, 60]]);
  });

  it('leaves a held note whole under the notes moving over it', () => {
    // The left hand holds a whole note while the right plays two halves.
    // Flattening the two would chop the held note into tied fragments; keeping
    // the voices apart leaves it exactly as it was written.
    const held =
      '<backup><duration>96</duration></backup>' +
      '<note><pitch><step>G</step><octave>3</octave></pitch><duration>96</duration>' +
      '<voice>2</voice><type>whole</type></note>';
    const { exercise } = importer.read(
      scoreXml(note('C', 5, 48, 'half') + note('D', 5, 48, 'half') + held),
    );

    const lower = exercise.staves[1]?.measures[0]?.entries ?? [];
    expect(lower).toHaveLength(1);
    expect(lower[0]?.duration.type).toBe('whole');
    expect(lower[0]?.kind === 'note' ? lower[0].tiedForward : ['unexpected']).toEqual([]);

    // Struck once, on the first beat, and never demanded again.
    expect(buildTimeline(exercise).steps.map((step) => step.expectedMidi)).toEqual([
      [55, 72],
      [74],
    ]);
  });

  it('lets two voices keep rhythms that do not divide the same way', () => {
    // Triplet quarters against plain eighths. Flattened into one line these cut
    // the bar into spans no plain value can write; as two voices they simply
    // keep their own.
    const triplet = (step: string) =>
      `<note><pitch><step>${step}</step><octave>3</octave></pitch><duration>16</duration>` +
      '<voice>2</voice><type>quarter</type>' +
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>' +
      '</time-modification></note>';
    const against =
      '<backup><duration>96</duration></backup>' +
      triplet('E') + triplet('F') + triplet('G') +
      '<note><rest/><duration>48</duration><voice>2</voice><type>half</type></note>';
    const eighths =
      note('C', 5, 12, 'eighth') + note('D', 5, 12, 'eighth') +
      note('E', 5, 12, 'eighth') + note('F', 5, 12, 'eighth') +
      note('G', 5, 48, 'half');
    const { exercise } = importer.read(scoreXml(eighths + against));

    const triplets = exercise.staves[1]?.measures[0]?.entries ?? [];
    expect(triplets.slice(0, 3).every((entry) => entry.duration.isTuplet)).toBe(true);
    // Both lines still fill the bar, each in its own subdivision.
    for (const staff of exercise.staves) {
      expect(
        staff.measures[0]?.entries.reduce((total, entry) => total + entry.duration.ticks, 0),
      ).toBe(Duration.WHOLE.ticks);
    }
  });

  it('leaves a voice out of the bars it sits out', () => {
    // A second voice that appears in one bar must not put a rest in every
    // other one - MuseScore hides an empty voice and so must the page here.
    const twoBars = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>24</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time>
      <clef><sign>G</sign><line>2</line></clef></attributes>
      ${note('C', 5, 96, 'whole')}
      <backup><duration>96</duration></backup>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>96</duration>
      <voice>2</voice><type>whole</type></note>
    </measure>
    <measure number="2">${note('D', 5, 96, 'whole')}</measure>
  </part>
</score-partwise>`;
    const { exercise } = importer.read(twoBars);

    expect(exercise.staves).toHaveLength(2);
    // The second voice is present in bar one and simply absent from bar two.
    expect(exercise.staves[1]?.measures[0]?.entries).toHaveLength(1);
    expect(exercise.staves[1]?.measures[1]?.entries).toHaveLength(0);

    // And nothing is written for it there, so no rest is drawn.
    const printed = serializer.serialize(exercise);
    const secondBar = printed.slice(printed.indexOf('<measure number="2"'));
    expect(secondBar).not.toContain('<rest');
    expect(secondBar).not.toContain('<backup>');
  });

  it('still draws a rest when a whole staff falls silent', () => {
    // Sparse voices vanish from the bars they sit out, but a staff where every
    // voice is absent is not sparse - it is resting, and a resting staff is
    // drawn with a rest. Exactly one, on the first voice.
    const twoStaves = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>24</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>
      <clef number="1"><sign>G</sign><line>2</line></clef>
      <clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>96</duration>
      <voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>96</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>96</duration>
      <voice>2</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>96</duration>
      <voice>1</voice><type>whole</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const { exercise } = importer.read(twoStaves);

    // The bass says nothing in bar two, so it rests rather than disappearing.
    const bass = exercise.staves[1]?.measures[1]?.entries ?? [];
    expect(bass).toHaveLength(1);
    expect(bass[0]?.kind).toBe('rest');
    expect(() => validateExercise(exercise)).not.toThrow();
  });

  it('follows a clef change instead of piling up ledger lines', () => {
    const changing = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>24</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time><staves>1</staves>
      <clef number="1"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>96</duration>
      <voice>1</voice><type>whole</type><staff>1</staff></note>
    </measure>
    <measure number="2">
      <attributes><clef number="1"><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>96</duration>
      <voice>1</voice><type>whole</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const { exercise } = importer.read(changing);

    expect(exercise.staves[0]?.clef).toBe('bass');
    expect(exercise.staves[0]?.clefChanges).toEqual([{ measureIndex: 1, clef: 'treble' }]);

    // And it is written back at the head of the bar it takes effect in.
    const printed = serializer.serialize(exercise);
    const secondBar = printed.slice(printed.indexOf('<measure number="2"'));
    expect(secondBar).toMatch(/<attributes>\s*<clef number="1">\s*<sign>G<\/sign>/);
  });

  it('follows a modulation instead of spelling it out', () => {
    // Held to the opening key, a piece that modulates comes out correct and
    // unreadable: every note of the new key carrying an accidental it should
    // not need.
    const modulating = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>24</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time><staves>1</staves>
      <clef number="1"><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>96</duration>
      <voice>1</voice><type>whole</type><staff>1</staff></note>
    </measure>
    <measure number="2">
      <attributes><key><fifths>-2</fifths></key></attributes>
      <note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch>
      <duration>96</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const { exercise } = importer.read(modulating);

    expect(exercise.key.fifths).toBe(0);
    expect(exercise.keyChanges).toHaveLength(1);
    expect(exercise.keyChanges[0]?.measureIndex).toBe(1);
    expect(exercise.keyChanges[0]?.key.fifths).toBe(-2);

    const printed = serializer.serialize(exercise);
    const secondBar = printed.slice(printed.indexOf('<measure number="2"'));
    expect(secondBar).toContain('<fifths>-2</fifths>');
    // B flat belongs to the new key, so it is not spelled with an accidental.
    expect(secondBar).not.toContain('<accidental>');
  });

  it('keeps a rolled chord rolled', () => {
    const rolled =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>96</duration>' +
      '<voice>1</voice><type>whole</type><notations><arpeggiate/></notations></note>' +
      '<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>96</duration>' +
      '<voice>1</voice><type>whole</type><notations><arpeggiate/></notations></note>';
    const { exercise } = importer.read(scoreXml(rolled));

    const entry = exercise.staves[0]?.measures[0]?.entries[0];
    expect(entry?.kind === 'note' ? entry.arpeggiated : false).toBe(true);
    // The squiggle is a reading instruction, so it has to reach the page.
    expect(serializer.serialize(exercise)).toContain('<arpeggiate/>');
  });

  it('carries a fermata and a breath mark, and prints them again', () => {
    // Both are the writer's own instructions and neither is a number: how
    // much longer to hold, and how long a lift, are the performer's. So they
    // belong on the page rather than in the rhythm - and the page had been
    // dropping both, which is a photocopy that has quietly lost two of the
    // things the reader is meant to read.
    const marked = note(
      'C',
      4,
      96,
      'whole',
      '<notations><fermata type="upright"/>' +
        '<articulations><breath-mark>comma</breath-mark></articulations></notations>',
    );
    const { exercise } = importer.read(scoreXml(marked));

    const entry = exercise.staves[0]?.measures[0]?.entries[0];
    expect(entry).toMatchObject({ kind: 'note', fermata: true, breath: true });

    const printed = new MusicXmlSerializer().serialize(exercise);
    expect(printed).toContain('<fermata');
    expect(printed).toContain('<breath-mark');
  });

  it('follows the damper pedal', () => {
    const pedalled =
      '<direction placement="below"><direction-type>' +
      '<pedal type="start" line="no" sign="yes"/></direction-type><staff>1</staff></direction>' +
      note('C', 4, 48, 'half') +
      '<direction placement="below"><direction-type>' +
      '<pedal type="stop" line="no" sign="yes"/></direction-type><staff>1</staff></direction>' +
      note('D', 4, 48, 'half');
    const { exercise } = importer.read(scoreXml(pedalled));

    expect(exercise.pedalMarks).toEqual([
      { measureIndex: 0, offsetTicks: 0, type: 'start' },
      { measureIndex: 0, offsetTicks: Duration.HALF.ticks, type: 'stop' },
    ]);

    const printed = serializer.serialize(exercise);
    expect(printed).toContain('<pedal type="start"');
    expect(printed).toContain('<pedal type="stop"');
  });

  it('keeps the stems that tell two voices apart', () => {
    // Which way a voice points is the writer's decision, not a rule: left to
    // the engraver each note follows its own pitch and the lines tangle.
    const upper =
      '<note><pitch><step>C</step><octave>5</octave></pitch><duration>96</duration>' +
      '<voice>1</voice><type>whole</type><stem>down</stem></note>';
    const lower =
      '<backup><duration>96</duration></backup>' +
      '<note><pitch><step>E</step><octave>4</octave></pitch><duration>96</duration>' +
      '<voice>2</voice><type>whole</type><stem>up</stem></note>';
    const { exercise } = importer.read(scoreXml(upper + lower));

    const first = exercise.staves[0]?.measures[0]?.entries[0];
    const second = exercise.staves[1]?.measures[0]?.entries[0];
    expect(first?.kind === 'note' ? first.stem : null).toBe('down');
    expect(second?.kind === 'note' ? second.stem : null).toBe('up');

    const printed = serializer.serialize(exercise);
    expect(printed).toContain('<stem>down</stem>');
    expect(printed).toContain('<stem>up</stem>');
  });

  it('keeps the beaming the writer chose', () => {
    // Two eighths beamed as a pair, a quarter, then another pair - which is
    // what this bar means, and not what an engraver left to guess would draw.
    const beamed =
      note('G', 4, 12, 'eighth', '<beam number="1">begin</beam>') +
      note('D', 5, 12, 'eighth', '<beam number="1">end</beam>') +
      note('G', 5, 24, 'quarter') +
      note('G', 5, 12, 'eighth', '<beam number="1">begin</beam>') +
      note('D', 5, 12, 'eighth', '<beam number="1">end</beam>') +
      note('B', 4, 24, 'quarter');
    const { exercise } = importer.read(scoreXml(beamed));

    const entries = exercise.staves[0]?.measures[0]?.entries ?? [];
    expect(entries.map((entry) => (entry.kind === 'note' ? entry.beams : []))).toEqual([
      [{ level: 1, type: 'begin' }],
      [{ level: 1, type: 'end' }],
      [],
      [{ level: 1, type: 'begin' }],
      [{ level: 1, type: 'end' }],
      [],
    ]);

    // And it survives back out, or the engraver would beam it its own way -
    // `autoBeam` only fills in for notes the XML says nothing about.
    const printed = serializer.serialize(exercise);
    expect([...printed.matchAll(/<beam number="1">/g)]).toHaveLength(4);
    expect(printed).toContain('<beam number="1">begin</beam>');
  });

  it('leaves generated music for the engraver to beam', () => {
    // Nothing we write ourselves carries beams, so `autoBeam` still decides -
    // which is what has always drawn the exercises.
    const generated = serializer.serialize(twoBarExercise());
    expect(generated).not.toContain('<beam');
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

  it('reads the short values a piano arrangement is written in', () => {
    // 48 divisions to the quarter, and a bar filled exactly: a run of
    // thirty-seconds and sixty-fourths is ordinary in the music being
    // imported, and refusing it turned away five of the reader's scores.
    const { exercise, warnings } = importer.read(
      scoreXml(
        note('C', 4, 96, 'half') +
          note('D', 4, 48, 'quarter') +
          note('E', 4, 24, 'eighth') +
          note('F', 4, 12, '16th') +
          note('G', 4, 6, '32nd') +
          note('A', 4, 3, '64th') +
          note('B', 4, 3, '64th'),
        48,
      ),
    );

    expect(warnings).toEqual([]);
    expect(exercise.staves[0]?.measures[0]?.entries.map((entry) => entry.duration.ticks)).toEqual(
      ['half', 'quarter', 'eighth', '16th', '32nd', '64th', '64th'].map(
        (type) => Duration.of(type as Parameters<typeof Duration.of>[0]).ticks,
      ),
    );
  });

  it('reads every part, since an exporter may write the hands as two', () => {
    // senbonzakura is exported that way: two parts of one staff each. Read
    // as the first part alone it opened, played, and was half the music -
    // which is worse than a refusal, because nothing on the page says a hand
    // is missing.
    const hands =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<score-partwise version="4.0">' +
      '<part-list>' +
      '<score-part id="P1"><part-name>Right</part-name></score-part>' +
      '<score-part id="P2"><part-name>Left</part-name></score-part>' +
      '</part-list>' +
      '<part id="P1"><measure number="1"><attributes><divisions>24</divisions>' +
      '<key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>' +
      '<clef><sign>G</sign><line>2</line></clef></attributes>' +
      note('C', 5, 96, 'whole') +
      '</measure></part>' +
      '<part id="P2"><measure number="1"><attributes><divisions>24</divisions>' +
      '<clef><sign>F</sign><line>4</line></clef></attributes>' +
      note('C', 3, 96, 'whole') +
      '</measure></part>' +
      '</score-partwise>';

    const { exercise, warnings } = importer.read(hands);

    expect(exercise.staves).toHaveLength(2);
    // A staff number groups voices onto one printed staff, and two parts
    // share neither that nor a voice number.
    expect(exercise.staves.map((staff) => staff.staffNumber)).toEqual([1, 2]);
    expect(exercise.staves.map((staff) => staff.voice)).toEqual([1, 2]);
    expect(exercise.staves.map((staff) => staff.clef)).toEqual(['treble', 'bass']);
    // And both hands are struck together, which is the point of reading both.
    expect(demands(exercise)).toEqual([[Pitch.parse('C3').midi, Pitch.parse('C5').midi]]);
    expect(warnings.map((warning) => warning.kind)).not.toContain('extra-parts');
  });

  it('leaves out a part that disagrees about how many bars there are', () => {
    const ragged =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<score-partwise version="4.0">' +
      '<part-list>' +
      '<score-part id="P1"><part-name>Right</part-name></score-part>' +
      '<score-part id="P2"><part-name>Left</part-name></score-part>' +
      '</part-list>' +
      '<part id="P1"><measure number="1"><attributes><divisions>24</divisions>' +
      '<key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>' +
      '<clef><sign>G</sign><line>2</line></clef></attributes>' +
      note('C', 5, 96, 'whole') +
      '</measure></part>' +
      '<part id="P2"><measure number="1"><attributes><divisions>24</divisions>' +
      '<clef><sign>F</sign><line>4</line></clef></attributes>' +
      note('C', 3, 96, 'whole') +
      '</measure><measure number="2">' +
      note('D', 3, 96, 'whole') +
      '</measure></part>' +
      '</score-partwise>';

    const { exercise, warnings } = importer.read(ragged);

    // Read, and said so: refusing the file would cost the reader a piece
    // that is otherwise sound.
    expect(exercise.staves).toHaveLength(1);
    expect(warnings.map((warning) => warning.kind)).toContain('extra-parts');
  });

  it('follows a metre change instead of holding the piece to its first bar', () => {
    // Three of the reader's scores were refused outright over this and a
    // fourth - Merry Christmas Mr Lawrence, 12/8 for one bar and 2/2 after it
    // - came in looking like music nobody wrote: 182 bars reported short and
    // padded with rests where the writer had half notes.
    const twoFour =
      '<measure number="2"><attributes><time><beats>2</beats><beat-type>4</beat-type>' +
      '</time></attributes>' +
      note('D', 4, 48, 'half') +
      '</measure>';
    const { exercise, warnings } = importer.read(
      // Straight after the first bar, which is where a second measure goes.
      scoreXml(note('C', 4, 96, 'whole')).replace('</measure>', '</measure>' + twoFour),
    );

    expect(warnings.map((warning) => warning.kind)).not.toContain('padded-measure');
    expect(timeAtMeasure(exercise, 0).toString()).toBe('4/4');
    expect(timeAtMeasure(exercise, 1).toString()).toBe('2/4');
    // The second bar is a half note and full, not a half note in a bar that
    // wanted a whole one.
    expect(measureTicks(exercise.staves[0]?.measures[1] ?? { entries: [] })).toBe(
      Duration.HALF.ticks,
    );
  });

  it('reads back a piece that widens its metre, both staves in step', () => {
    // The reader's report: nausicaa opened and drew nothing, and opening it
    // again from the library failed outright. Both were the same fault - the
    // `<backup>` that sends the writer back to the start of the bar for the
    // second staff was written as the length of the *first* bar of the piece.
    // In a bar that had grown from 3/4 to 4/4 the second staff began a
    // quarter late and ran a quarter past the bar line, so the file we had
    // just written was one neither we nor the engraver could read.
    const base = twoBarExercise();
    const [treble, bass] = base.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('expected two staves');
    }
    const widening = {
      ...base,
      timeSignature: new TimeSignature(3, 4),
      timeChanges: [{ measureIndex: 1, timeSignature: new TimeSignature(4, 4) }],
      staves: [
        {
          ...treble,
          measures: [
            { entries: [noteEntry(Pitch.parse('C4'), Duration.DOTTED_HALF)] },
            { entries: [noteEntry(Pitch.parse('D4'), Duration.WHOLE)] },
          ],
        },
        {
          ...bass,
          measures: [
            { entries: [noteEntry(Pitch.parse('C3'), Duration.DOTTED_HALF)] },
            { entries: [noteEntry(Pitch.parse('G2'), Duration.WHOLE)] },
          ],
        },
      ],
    };
    validateExercise(widening);

    const { exercise } = importer.read(serializer.serialize(widening));

    expect(timeAtMeasure(exercise, 0).toString()).toBe('3/4');
    expect(timeAtMeasure(exercise, 1).toString()).toBe('4/4');
    expect(demands(exercise)).toEqual(demands(widening));
  });

  it('writes a metre change back out, so the engraver draws the new bar lines', () => {
    const base = twoBarExercise();
    const [treble, bass] = base.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('expected two staves');
    }
    const changed = {
      ...base,
      timeChanges: [{ measureIndex: 1, timeSignature: new TimeSignature(3, 4) }],
      staves: [
        {
          ...treble,
          measures: [treble.measures[0] ?? { entries: [] }, { entries: [] }],
        },
        {
          ...bass,
          measures: [bass.measures[0] ?? { entries: [] }, { entries: [] }],
        },
      ],
    };
    const withThree = {
      ...changed,
      staves: changed.staves.map((staff) => ({
        ...staff,
        measures: [
          staff.measures[0] ?? { entries: [] },
          { entries: [restEntry(Duration.DOTTED_HALF)] },
        ],
      })),
    };

    const { exercise } = importer.read(serializer.serialize(withThree));

    expect(timeAtMeasure(exercise, 1).toString()).toBe('3/4');
  });

  it('reads a score that names no tempo at the speed everything else assumes', () => {
    // Plenty of arrangements carry no <sound> and no metronome mark at all -
    // the Nier one carries neither anywhere in it. Something has to be
    // assumed, and 120 is what MuseScore assumes in the same case, so a file
    // with no mark opens here at the speed it opened where the reader saw it
    // last. At 72 it opened noticeably slower and looked like the writer's
    // own marking rather than our guess.
    const { exercise } = importer.read(scoreXml(note('C', 4, 96, 'whole')));

    expect(exercise.tempoBpm).toBe(120);
  });

  it('still takes the tempo the file does state', () => {
    const stated =
      '<direction placement="above"><direction-type>' +
      '<metronome><beat-unit>quarter</beat-unit><per-minute>63</per-minute></metronome>' +
      '</direction-type><sound tempo="63"/></direction>';
    const { exercise } = importer.read(scoreXml(stated + note('C', 4, 96, 'whole')));

    expect(exercise.tempoBpm).toBe(63);
  });

  /** A score with no `<time>` at all, and one measure per line of music. */
  function unbarred(body: string): string {
    return scoreXml(body).replace('<time><beats>4</beats><beat-type>4</beat-type></time>', '');
  }

  it('finds the metre of a score that carries none, and cuts its lines into bars', () => {
    // A file nobody gave a time signature draws no bar lines either, so its
    // program writes one `<measure>` per *line* - seven or eight bars of
    // music in each. Refused for want of a metre, the reader lost the piece
    // entirely; there is nothing here to count them into otherwise.
    const eightQuarters = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C']
      .map((step) => note(step, 4, 24, 'quarter'))
      .join('');
    const { exercise, warnings } = importer.read(unbarred(eightQuarters));

    expect(() => validateExercise(exercise)).not.toThrow();
    expect(exercise.timeSignature.toString()).toBe('4/4');
    // One line of eight quarters is two bars, not one bar of eight.
    expect(measureCount(exercise)).toBe(2);
    expect(warnings.map((warning) => warning.detail).join(' ')).toContain('no bar lines');
  });

  it('picks the metre that cuts no note in half, not merely the first that fits', () => {
    // Twelve quarters, as four dotted halves. The length suits 4/4 as well as
    // 3/4, and 4/4 is tried first - but its second bar line would fall in the
    // middle of the note that runs from the third quarter to the sixth. A
    // metre that cuts a note is not a worse reading of the music, it is a
    // wrong one, so 3/4 is the answer even though it was tried second.
    const dottedHalves = ['C', 'D', 'E', 'F']
      .map((step) => note(step, 4, 72, 'half', '<dot/>'))
      .join('');
    const { exercise } = importer.read(unbarred(dottedHalves));

    expect(exercise.timeSignature.toString()).toBe('3/4');
    expect(measureCount(exercise)).toBe(4);
    expect(() => validateExercise(exercise)).not.toThrow();
  });

  it('still refuses a score no ordinary metre will bar', () => {
    // Seven quarters: no metre worth trying divides them, and barring it
    // anyway would be inventing music the writer did not write.
    const seven = Array.from({ length: 7 }, () => note('C', 4, 24, 'quarter')).join('');
    expect(() => importer.read(unbarred(seven))).toThrow(/time signature/);
  });

  it('takes a note at what it sounds, not at what it is drawn as', () => {
    // MuseScore leaves a note looking whole while giving it the duration of
    // a shade less, to make room for what follows. Read as the type alone,
    // the bar adds up to more than the metre allows and the file is refused
    // outright - which is how the reader lost the-sixth-station over one bar.
    // 24 divisions to the quarter, so this whole note sounds 90 of the 96 it
    // is drawn as: a dotted half tied to a dotted eighth.
    const { exercise } = importer.read(
      scoreXml(note('C', 4, 90, 'whole') + note('D', 4, 6, '16th')),
    );

    expect(() => validateExercise(exercise)).not.toThrow();
    const entries = exercise.staves[0]?.measures[0]?.entries ?? [];
    expect(entries.map((entry) => entry.duration.ticks)).toEqual([
      Duration.DOTTED_HALF.ticks,
      Duration.of('eighth', 1).ticks,
      Duration.SIXTEENTH.ticks,
    ]);
    // One press, not two: the pieces are held together, so the reader is
    // never asked for the note again partway through it.
    const first = entries[0];
    expect(first?.kind === 'note' ? first.tiedForward : []).toEqual([Pitch.parse('C4').midi]);
    // The engraver draws a notehead where the tie continues, so there is a
    // position there - and nothing is asked for at it, which is what makes
    // the whole thing one press.
    expect(demands(exercise)).toEqual([[Pitch.parse('C4').midi], [], [Pitch.parse('D4').midi]]);
  });

  it('leaves a note alone when it sounds what it says', () => {
    const { exercise } = importer.read(scoreXml(note('C', 4, 96, 'whole')));

    expect(exercise.staves[0]?.measures[0]?.entries.map((entry) => entry.duration.ticks)).toEqual([
      Duration.WHOLE.ticks,
    ]);
  });

  it('reads a septuplet a file could not divide evenly', () => {
    // 24 divisions to the quarter, so a seventh of a beat is 3.43 of them and
    // MuseScore writes 3, 4, 3, 4, 3, 4, 3 - adding up to the beat while no
    // one of them is a seventh of it. This is how every septuplet in the
    // reader's scores is written, the Debussy and the Ocarina among them.
    const septuplet = (step: string, duration: number): string =>
      note(step, 4, duration, '16th', '<time-modification><actual-notes>7</actual-notes>' +
        '<normal-notes>4</normal-notes></time-modification>');
    const { exercise } = importer.read(
      scoreXml(
        septuplet('C', 3) +
          septuplet('D', 4) +
          septuplet('E', 3) +
          septuplet('F', 4) +
          septuplet('G', 3) +
          septuplet('A', 4) +
          septuplet('B', 3) +
          note('C', 5, 72, 'half', '<dot/>'),
      ),
    );

    expect(() => validateExercise(exercise)).not.toThrow();
    const entries = exercise.staves[0]?.measures[0]?.entries ?? [];
    // Seven equal sevenths, whatever the file called them one by one.
    expect(entries.slice(0, 7).map((entry) => entry.duration.ticks)).toEqual(
      Array.from({ length: 7 }, () => Duration.QUARTER.ticks / 7),
    );
    // And the note after the group is still on the second beat, which is the
    // whole reason the roundings must not be allowed to accumulate.
    const onsets = buildTimeline(exercise).steps.map((step) => step.onsetTicks);
    expect(onsets[7]).toBe(Duration.QUARTER.ticks);
  });

  it('still refuses a group that disagrees with itself by a real value', () => {
    // Rounding is a division or so. A note written as a triplet eighth and
    // lasting a whole beat is not rounding; it is a file we cannot trust.
    const wrong = note('C', 4, 24, 'eighth', '<time-modification><actual-notes>3</actual-notes>' +
      '<normal-notes>2</normal-notes></time-modification>');
    expect(() => importer.read(scoreXml(wrong + note('D', 4, 72, 'half', '<dot/>')))).toThrow(
      /disagrees with itself/,
    );
  });

  it('refuses a value it cannot write, and says which', () => {
    // 32 divisions to the quarter, so a 128th is one of them - shorter than
    // anything that can be drawn here, and not a rounding away from something
    // that can.
    expect(() =>
      importer.read(scoreXml(note('C', 4, 1, '128th') + note('D', 4, 127, 'whole'), 32)),
    ).toThrow(/sixty-fourth notes/);
  });
});

/** Builds a `.mxl` the way an exporter would: a ZIP with a named root file. */
function packMxl(files: readonly { readonly name: string; readonly body: string }[]): ArrayBuffer {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const raw = encoder.encode(file.body);
    const packed = new Uint8Array(deflateRawSync(raw));

    const local = new Uint8Array(30 + name.length + packed.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, 8, true);
    localView.setUint32(18, packed.length, true);
    localView.setUint32(22, raw.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(packed, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, 8, true);
    centralView.setUint32(20, packed.length, true);
    centralView.setUint32(24, raw.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const directorySize = centrals.reduce((total, entry) => total + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);

  const total = offset + directorySize + end.length;
  const archive = new Uint8Array(total);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    archive.set(part, at);
    at += part.length;
  }
  return archive.buffer;
}

describe('compressed scores', () => {
  // Node's inflater stands in for the browser's, so the archive reading is
  // tested rather than the platform's decompressor.
  const zipped = new DomScoreImporter(undefined, async (bytes) =>
    new Uint8Array(inflateRawSync(bytes)),
  );

  const container =
    '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles>' +
    '<rootfile full-path="Score/score.xml"/></rootfiles></container>';

  it('opens the score inside a .mxl', async () => {
    const original = twoBarExercise({ title: 'Packed Away' });
    const archive = packMxl([
      { name: 'META-INF/container.xml', body: container },
      { name: 'Score/score.xml', body: serializer.serialize(original) },
    ]);

    expect(looksZipped(new Uint8Array(archive))).toBe(true);
    const { exercise } = await zipped.readFile(archive);

    expect(exercise.title).toBe('Packed Away');
    expect(demands(exercise)).toEqual(demands(original));
  });

  it('ignores everything the exporter packed alongside it', async () => {
    const original = twoBarExercise({ title: 'Packed Away' });
    const archive = packMxl([
      { name: 'META-INF/container.xml', body: container },
      { name: 'sleeve.txt', body: 'cover art goes here' },
      { name: 'Score/score.xml', body: serializer.serialize(original) },
    ]);

    const { exercise } = await zipped.readFile(archive);
    expect(exercise.title).toBe('Packed Away');
  });

  it('finds the score even without a container manifest', async () => {
    const archive = packMxl([
      { name: 'score.musicxml', body: serializer.serialize(twoBarExercise({ title: 'Bare' })) },
    ]);

    const { exercise } = await zipped.readFile(archive);
    expect(exercise.title).toBe('Bare');
  });

  it('still reads a plain, uncompressed file', async () => {
    const xml = serializer.serialize(twoBarExercise({ title: 'Plain' }));
    const bytes = new TextEncoder().encode(xml);

    expect(looksZipped(bytes)).toBe(false);
    const { exercise } = await zipped.readFile(bytes.buffer as ArrayBuffer);
    expect(exercise.title).toBe('Plain');
  });

  it('says so when the archive holds no score at all', async () => {
    const archive = packMxl([{ name: 'notes.txt', body: 'nothing musical here' }]);
    await expect(zipped.readFile(archive)).rejects.toThrow(/no score in it/);
  });
});

describe('a grace note', () => {
  /** A note carrying `<grace/>`, which has no duration of its own. */
  function grace(step: string, octave: number, extra = ''): string {
    return `<note><grace slash="yes"/><pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
      `<voice>1</voice><type>eighth</type>${extra}</note>`;
  }

  /** A quarter, a grace, the quarter it leans on, then the rest of the bar. */
  function bar(graces: string): string {
    return scoreXml(
      note('C', 4, 24, 'quarter') +
        graces +
        note('A', 4, 24, 'quarter') +
        note('B', 4, 48, 'half'),
    );
  }

  it('leaves the note it leans on exactly where it was', () => {
    // The whole point. Taking the time from the host instead put every note
    // after the ornament late, and the beat is the one thing a sight-reading
    // trainer must not move.
    const { exercise } = importer.read(bar(grace('G', 4)));

    expect(() => validateExercise(exercise)).not.toThrow();
    const onsets = buildTimeline(exercise).steps.map((step) => step.onsetTicks);
    // Beat one, the grace just before beat two, beat two itself, beat three.
    const q = Duration.QUARTER.ticks;
    expect(onsets).toEqual([0, q * 0.75, q, q * 2]);
  });

  it('takes its time from whatever was sounding before it', () => {
    const { exercise, warnings } = importer.read(bar(grace('G', 4)));

    const entries = exercise.staves[0]?.measures[0]?.entries ?? [];
    // The quarter before gives up a sixteenth and becomes a dotted eighth.
    const q = Duration.QUARTER.ticks;
    expect(entries.map((entry) => entry.duration.ticks)).toEqual([q * 0.75, q / 4, q, q * 2]);
    expect(warnings.map((warning) => warning.kind)).toContain('grace-notes');
  });

  it('is asked for, which is the whole point of keeping it', () => {
    const { exercise } = importer.read(bar(grace('G', 4)));

    expect(demands(exercise)).toEqual([
      [Pitch.parse('C4').midi],
      [Pitch.parse('G4').midi],
      [Pitch.parse('A4').midi],
      [Pitch.parse('B4').midi],
    ]);
  });

  it('is dropped when there is nothing in front of it to take from', () => {
    // An ornament missing is a smaller loss than every note after it being
    // off the beat.
    const { exercise, warnings } = importer.read(
      scoreXml(grace('G', 4) + note('A', 4, 24, 'quarter') + note('B', 4, 72, 'half', '<dot/>')),
    );

    expect(() => validateExercise(exercise)).not.toThrow();
    expect(warnings.map((warning) => warning.detail).join(' ')).toContain('nothing before it');
    // And the note it leaned on is still on beat one.
    expect(buildTimeline(exercise).steps[0]?.onsetTicks).toBe(0);
    expect(demands(exercise)[0]).toEqual([Pitch.parse('A4').midi]);
  });

  it('is dropped when what is before it is too short to give any', () => {
    const { exercise, warnings } = importer.read(
      scoreXml(
        note('C', 4, 6, '16th') +
          grace('G', 4) +
          note('A', 4, 18, 'eighth', '<dot/>') +
          note('B', 4, 72, 'half', '<dot/>'),
      ),
    );

    expect(() => validateExercise(exercise)).not.toThrow();
    expect(warnings.map((warning) => warning.kind)).toContain('grace-notes');
    expect(demands(exercise)).toHaveLength(3);
  });

  it('strikes two grace notes together when they are marked as a chord', () => {
    const { exercise } = importer.read(bar(grace('G', 4) + grace('B', 4, '<chord/>')));

    // One press of two keys, which is what the mark means.
    expect(demands(exercise)[1]).toEqual([Pitch.parse('G4').midi, Pitch.parse('B4').midi]);
    const q = Duration.QUARTER.ticks;
    expect(buildTimeline(exercise).steps.map((step) => step.onsetTicks)).toEqual([
      0, q * 0.75, q, q * 2,
    ]);
  });

  it('makes room for two of them in turn', () => {
    const { exercise } = importer.read(bar(grace('G', 4) + grace('A', 4)));

    // Two presses before the beat, and the beat still where it was.
    const q = Duration.QUARTER.ticks;
    expect(buildTimeline(exercise).steps.map((step) => step.onsetTicks)).toEqual([
      0, q / 2, q * 0.75, q, q * 2,
    ]);
  });

  it('says once what it did, rather than once for every bar', () => {
    const { warnings } = importer.read(bar(grace('G', 4)));

    expect(warnings.filter((warning) => warning.kind === 'grace-notes')).toHaveLength(1);
  });
});
