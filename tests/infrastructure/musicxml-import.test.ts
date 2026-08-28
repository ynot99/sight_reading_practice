// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { DomMusicXmlImporter } from '../../src/infrastructure/notation/DomMusicXmlImporter.js';
import { looksZipped } from '../../src/infrastructure/notation/zip.js';
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

  it('merges the voices of a staff into one line', () => {
    // Two whole notes struck together in different voices are one chord to
    // the hand that has to play them.
    const second =
      '<backup><duration>96</duration></backup>' +
      '<note><pitch><step>G</step><octave>3</octave></pitch><duration>96</duration>' +
      '<voice>2</voice><type>whole</type></note>';
    const { exercise, warnings } = importer.read(scoreXml(note('C', 4, 96, 'whole') + second));

    expect(warnings.map((warning) => warning.kind)).toContain('merged-voices');
    const entries = exercise.staves[0]?.measures[0]?.entries ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind === 'note' ? entries[0].pitches.map((p) => p.toString()) : []).toEqual([
      'G3',
      'C4',
    ]);
  });

  it('ties a held voice across the notes moving under it', () => {
    // The left hand holds a whole note while the right plays two halves. The
    // held note is cut at the join and tied, so the page keeps its length and
    // the hand still presses it once.
    const held =
      '<backup><duration>96</duration></backup>' +
      '<note><pitch><step>G</step><octave>3</octave></pitch><duration>96</duration>' +
      '<voice>2</voice><type>whole</type></note>';
    const { exercise } = importer.read(
      scoreXml(note('C', 5, 48, 'half') + note('D', 5, 48, 'half') + held),
    );

    const entries = exercise.staves[0]?.measures[0]?.entries ?? [];
    expect(entries).toHaveLength(2);
    expect(entries[0]?.kind === 'note' ? entries[0].tiedForward : []).toEqual([55]);
    expect(entries[1]?.kind === 'note' ? entries[1].tiedForward : []).toEqual([]);

    // Demanded once, on the beat it was struck - which is the whole point.
    const steps = buildTimeline(exercise).steps;
    expect(steps.map((step) => step.expectedMidi)).toEqual([[55, 72], [74]]);
  });

  it('falls back on a bar whose voices cross-rhythm, and says which', () => {
    // Triplet quarters against plain eighths cut the bar into spans no plain
    // value can write, so that bar keeps the first voice only.
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
    const { exercise, warnings } = importer.read(scoreXml(eighths + against));

    const merged = warnings.find((warning) => warning.kind === 'merged-voices');
    expect(merged?.detail).toContain('cross-rhythm');
    // The bar still adds up, which is what the fallback is protecting.
    const entries = exercise.staves[0]?.measures[0]?.entries ?? [];
    expect(entries.reduce((total, entry) => total + entry.duration.ticks, 0)).toBe(1920);
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

  it('refuses a value it cannot write, and says which', () => {
    // A 32nd note is 3 divisions here, and this trainer reads down to
    // sixteenths.
    expect(() => importer.read(scoreXml(note('C', 4, 3, '32nd') + note('D', 4, 93, 'whole')))).toThrow(
      /sixteenth notes/,
    );
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
  const zipped = new DomMusicXmlImporter(undefined, async (bytes) =>
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
