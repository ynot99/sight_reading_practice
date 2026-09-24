// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { DYNAMIC_LEVELS, DYNAMIC_VELOCITY, velocityAt } from '../../src/domain/model/Exercise.js';
import {
  clefAt,
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
import { longExercise, tiedExercise, twoBarExercise } from '../support/fixtures.js';
import { UNSEEN_NOTE, UNSEEN_NOTES } from '../support/printed.js';

const importer = new DomScoreImporter();
const serializer = new MusicXmlSerializer();

/** What the player is asked to press, step by step. */
function demands(exercise: Parameters<typeof buildTimeline>[0]): readonly (readonly number[])[] {
  return buildTimeline(exercise).steps.map((step) => step.expectedMidi);
}

describe('the dynamics on the page', () => {
  /** A piece marked at the start, and again at the second bar. */
  function marked(): ReturnType<typeof twoBarExercise> {
    return {
      ...twoBarExercise(),
      dynamicMarks: [
        { measureIndex: 0, offsetTicks: 0, level: 'pp' as const, staffNumber: 1 },
        { measureIndex: 1, offsetTicks: 0, level: 'ff' as const, staffNumber: null },
      ],
    };
  }

  it('writes them where the writer put them, and reads them back', () => {
    // Notation the writer chose is carried, not recomputed - the same rule
    // the beams and the stems follow.
    const original = marked();

    const { exercise } = importer.read(serializer.serialize(original));

    // Below, which is where a piano dynamic goes and what a mark that says
    // nothing about its side is printed as.
    expect(exercise.dynamicMarks).toEqual([
      { measureIndex: 0, offsetTicks: 0, level: 'pp', staffNumber: 1, placement: 'below' },
      { measureIndex: 1, offsetTicks: 0, level: 'ff', staffNumber: 1, placement: 'below' },
    ]);
  });

  it('keeps a mark the writer put above the staff above it', () => {
    // A staff carrying two lines marks the upper one above. Forced below,
    // every mark in the bar ends up in one row under it and which line each
    // belongs to is gone - measured on a Minecraft arrangement whose upper
    // line is marked pp against the lower line's p.
    const original = {
      ...twoBarExercise(),
      dynamicMarks: [
        { measureIndex: 0, offsetTicks: 0, level: 'pp' as const, staffNumber: 1, placement: 'above' as const },
        { measureIndex: 1, offsetTicks: 0, level: 'p' as const, staffNumber: 1 },
      ],
    };

    const printed = serializer.serialize(original);
    const { exercise } = importer.read(printed);

    expect(printed).toContain('placement="above"');
    expect(exercise.dynamicMarks.map((mark) => mark.placement)).toEqual(['above', 'below']);
  });

  it('writes each mark once, however many voices share the staff', () => {
    const printed = serializer.serialize(marked());

    expect([...printed.matchAll(/<dynamics>/g)]).toHaveLength(2);
  });

  it('carries the quietest and the loudest a piano piece is written in', () => {
    // Clair de Lune opens in pp and asks for ppp before the first page is
    // out; stopping at two p's would play its quietest music at the same
    // loudness as its merely quiet music.
    const original = {
      ...twoBarExercise(),
      dynamicMarks: [
        { measureIndex: 0, offsetTicks: 0, level: 'ppp' as const, staffNumber: null },
        { measureIndex: 1, offsetTicks: 0, level: 'fff' as const, staffNumber: null },
      ],
    };

    const { exercise } = importer.read(serializer.serialize(original));

    expect(exercise.dynamicMarks.map((mark) => mark.level)).toEqual(['ppp', 'fff']);
  });

  it('carries the levels past three p\u2019s, niente included', () => {
    // His Minecraft arrangement asks for pppp, and ends on n - nothing -
    // under a seven-bar diminuendo. A level this program cannot name is
    // dropped, and a dropped one does not merely go unprinted: the music
    // carries on at whatever was in force before it.
    const original = {
      ...twoBarExercise(),
      dynamicMarks: [
        { measureIndex: 0, offsetTicks: 0, level: 'pppp' as const, staffNumber: 1 },
        { measureIndex: 1, offsetTicks: 0, level: 'n' as const, staffNumber: 1 },
      ],
    };

    const printed = serializer.serialize(original);
    const { exercise } = importer.read(printed);

    // Niente has no element of its own in the format and goes in the one
    // kept for what the format did not think of.
    expect(printed).toContain('<other-dynamics>n</other-dynamics>');
    expect(exercise.dynamicMarks.map((mark) => mark.level)).toEqual(['pppp', 'n']);
  });

  it('fades to nothing where a diminuendo closes on the barline', () => {
    // The ending he reported: seven bars of diminuendo stopping at a
    // barline, with niente written under the first note after it. The wedge
    // and the mark are one moment spelled two ways, and asked bar by bar
    // rather than in ticks the wedge could not see what it was heading for -
    // so it dropped a single step and the ending stayed loud.
    const piece = {
      ...longExercise({ bars: 4, tempoBpm: 60 }),
      dynamicMarks: [
        { measureIndex: 0, offsetTicks: 0, level: 'p' as const, staffNumber: 1 },
        { measureIndex: 3, offsetTicks: 0, level: 'n' as const, staffNumber: 1 },
      ],
      hairpins: [
        {
          measureIndex: 0,
          offsetTicks: 0,
          kind: 'diminuendo' as const,
          untilMeasureIndex: 2,
          untilOffsetTicks: Duration.WHOLE.ticks,
          staffNumber: 1,
        },
      ],
    };
    const heard = [0, 1, 2, 3].map((bar) => velocityAt(piece, bar, 0, 1));

    expect(heard[0]).toBeCloseTo(DYNAMIC_VELOCITY.p, 5);
    expect(heard[3]).toBeCloseTo(DYNAMIC_VELOCITY.n, 5);
    for (let at = 1; at < heard.length; at += 1) {
      expect(heard[at] ?? 1).toBeLessThan(heard[at - 1] ?? 0);
    }
  });

  it('spreads the levels widely enough to be heard apart', () => {
    // Reported from the page: he could see f, mf and mp and hear no
    // difference. Two neighbouring levels three decibels apart is a
    // difference nobody notices in music; from ppp to fff is now about
    // fifteen, and the player darkens a quiet note as well as lowering it.
    const levels = DYNAMIC_LEVELS.map((level) => DYNAMIC_VELOCITY[level]);

    for (let at = 1; at < levels.length; at += 1) {
      expect(levels[at] ?? 0).toBeGreaterThan(levels[at - 1] ?? 0);
    }
    const softest = levels[0] ?? 1;
    const loudest = levels[levels.length - 1] ?? 1;
    expect(loudest / softest).toBeGreaterThan(4);
  });

  it('prints the words it obeys and no others', () => {
    // Reported from the page: a rit. turned into a row of tempo numbers
    // across the bar, and text appeared over bar one that the reader had
    // not asked for. What is printed is what is obeyed - the rest is
    // carried in the piece and left off the page.
    const spoken = {
      ...twoBarExercise(),
      tempoWords: [
        { measureIndex: 0, offsetTicks: 0, text: 'Andante', kind: 'other' as const },
        { measureIndex: 1, offsetTicks: 0, text: 'rit.', kind: 'ritardando' as const },
      ],
    };

    const printed = serializer.serialize(spoken);

    expect(printed).toContain('rit.');
    expect(printed).not.toContain('Andante');
  });

  it('reads an octave sign from its two ends, and writes it back', () => {
    // 8va and 15ma: a way of writing high music without a thicket of ledger
    // lines. The pitch in the file is always the sounding one, so this
    // changes nothing about the music - only what the page looks like.
    const printed = serializer.serialize({
      ...twoBarExercise(),
      octaveShifts: [
        {
          measureIndex: 0,
          offsetTicks: 0,
          untilMeasureIndex: 1,
          untilOffsetTicks: 0,
          direction: 'down' as const,
          size: 15 as const,
          staffNumber: 1,
        },
      ],
    });

    const { exercise } = importer.read(printed);

    expect(printed).toContain('<octave-shift type="down" size="15"');
    expect(printed).toContain('<octave-shift type="stop"');
    expect(exercise.octaveShifts).toEqual([
      {
        measureIndex: 0,
        offsetTicks: 0,
        untilMeasureIndex: 1,
        untilOffsetTicks: 0,
        direction: 'down',
        size: 15,
        staffNumber: 1,
      },
    ]);
  });

  it('does not move a note that is written under one', () => {
    // The sign is about the drawing. What the reader has to play is what the
    // file says they play.
    const written = twoBarExercise();
    const signed = {
      ...written,
      octaveShifts: [
        {
          measureIndex: 0,
          offsetTicks: 0,
          untilMeasureIndex: 0,
          untilOffsetTicks: Duration.WHOLE.ticks,
          direction: 'down' as const,
          size: 8 as const,
          staffNumber: 1,
        },
      ],
    };

    const { exercise } = importer.read(serializer.serialize(signed));

    expect(demands(exercise)).toEqual(demands(written));
  });

  it('reads a hairpin from its two ends, and writes it back', () => {
    // The format states a start and a stop as separate directions; what a
    // reader sees is one wedge under the music between them.
    const printed = serializer.serialize({
      ...twoBarExercise(),
      hairpins: [
        {
          measureIndex: 0,
          offsetTicks: 0,
          kind: 'crescendo' as const,
          untilMeasureIndex: 1,
          untilOffsetTicks: 0,
          staffNumber: 1,
        },
      ],
    });

    const { exercise } = importer.read(printed);

    expect(printed).toContain('<wedge type="crescendo"');
    expect(printed).toContain('<wedge type="stop"');
    expect(exercise.hairpins).toEqual([
      {
        measureIndex: 0,
        offsetTicks: 0,
        kind: 'crescendo',
        untilMeasureIndex: 1,
        untilOffsetTicks: 0,
        staffNumber: 1,
        placement: 'below',
      },
    ]);
  });

  it('reads a crescendo written as a word over a dashed line', () => {
    // Bars 188 to 189 of his Minecraft arrangement say `cresc.` with a dashed
    // line rather than drawing a wedge. It is the same crescendo, and read as
    // a word this program printed nothing and played nothing.
    const worded = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>24</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time><staves>1</staves>
      <clef number="1"><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="below">
        <direction-type><dynamics><p/></dynamics></direction-type>
        <staff>1</staff>
      </direction>
      <direction placement="below">
        <direction-type><words font-style="italic">cresc.</words></direction-type>
        <direction-type><dashes type="start" number="1"/></direction-type>
        <staff>1</staff>
      </direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>48</duration>
      <voice>1</voice><type>half</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>48</duration>
      <voice>1</voice><type>half</type><staff>1</staff></note>
      <direction placement="below">
        <direction-type><dashes type="stop" number="1"/></direction-type>
        <staff>1</staff>
      </direction>
    </measure>
  </part>
</score-partwise>`;
    const { exercise } = importer.read(worded);

    expect(exercise.hairpins).toEqual([
      {
        measureIndex: 0,
        offsetTicks: 0,
        kind: 'crescendo',
        untilMeasureIndex: 0,
        untilOffsetTicks: Duration.WHOLE.ticks,
        staffNumber: 1,
        placement: 'below',
        text: 'cresc.',
      },
    ]);

    // Heard as a crescendo is: the second half of the bar is louder.
    expect(velocityAt(exercise, 0, Duration.HALF.ticks, 1)).toBeGreaterThan(
      velocityAt(exercise, 0, 0, 1),
    );

    // And printed back as the word it was. A wedge here would be this
    // program choosing the engraving, which is the one thing it does not do.
    const printed = serializer.serialize(exercise);

    expect(printed).toContain('<words font-style="italic">cresc.</words>');
    expect(printed).toContain('<dashes type="start"');
    expect(printed).not.toContain('<wedge');
    expect(importer.read(printed).exercise.hairpins).toEqual(exercise.hairpins);
  });

  it('does not pair a wedge with a dashed word that shares its number', () => {
    // The format counts wedges and dashes separately, so both can be number
    // one at once. Paired by the number alone, a `cresc.` closing on a
    // wedge's stop makes one hairpin out of two and loses the other.
    const both = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>24</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time><staves>1</staves>
      <clef number="1"><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="below">
        <direction-type><words font-style="italic">cresc.</words></direction-type>
        <direction-type><dashes type="start" number="1"/></direction-type>
        <staff>1</staff>
      </direction>
      <direction placement="above">
        <direction-type><wedge type="diminuendo" number="1"/></direction-type>
        <staff>1</staff>
      </direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>48</duration>
      <voice>1</voice><type>half</type><staff>1</staff></note>
      <direction placement="above">
        <direction-type><wedge type="stop" number="1"/></direction-type>
        <staff>1</staff>
      </direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>48</duration>
      <voice>1</voice><type>half</type><staff>1</staff></note>
      <direction placement="below">
        <direction-type><dashes type="stop" number="1"/></direction-type>
        <staff>1</staff>
      </direction>
    </measure>
  </part>
</score-partwise>`;
    const { exercise } = importer.read(both);

    expect(
      exercise.hairpins.map((one) => `${one.kind} ${one.text ?? 'wedge'}`).sort(),
    ).toEqual(['crescendo cresc.', 'diminuendo wedge']);
  });

  it('keeps two hairpins on the sides the writer drew them on', () => {
    // One line swelling above the staff while another fades below it is
    // ordinary piano writing. Both forced below, they are stacked one
    // beneath the other and the page no longer says which line each is for.
    const printed = serializer.serialize({
      ...twoBarExercise(),
      hairpins: [
        {
          measureIndex: 0,
          offsetTicks: 0,
          kind: 'crescendo' as const,
          untilMeasureIndex: 1,
          untilOffsetTicks: 0,
          staffNumber: 1,
          placement: 'above' as const,
        },
        {
          measureIndex: 0,
          offsetTicks: 0,
          kind: 'diminuendo' as const,
          untilMeasureIndex: 1,
          untilOffsetTicks: 0,
          staffNumber: 1,
          placement: 'below' as const,
        },
      ],
    });

    const { exercise } = importer.read(printed);

    expect(
      exercise.hairpins.map((hairpin) => `${hairpin.kind} ${hairpin.placement ?? 'unsaid'}`).sort(),
    ).toEqual(['crescendo above', 'diminuendo below']);
  });

  it('is heard as a slope by the time it is read in', () => {
    // Measured and found wanting: expanding a hairpin into the written
    // levels gave one change, at the very end, which is not a crescendo. The
    // loudness is worked out at each note instead, so the rise is as smooth
    // as the notes come.
    const printed = serializer.serialize({
      ...twoBarExercise(),
      dynamicMarks: [
        { measureIndex: 0, offsetTicks: 0, level: 'pp' as const, staffNumber: null },
        { measureIndex: 1, offsetTicks: 0, level: 'f' as const, staffNumber: null },
      ],
      hairpins: [
        {
          measureIndex: 0,
          offsetTicks: 0,
          kind: 'crescendo' as const,
          untilMeasureIndex: 1,
          untilOffsetTicks: 0,
          staffNumber: null,
        },
      ],
    });

    const { exercise } = importer.read(printed);
    const quarter = Duration.QUARTER.ticks;
    const climbing = [0, quarter, quarter * 2, quarter * 3].map((at) =>
      velocityAt(exercise, 0, at, 1),
    );

    // Every step louder than the last, from the pp it starts at towards the
    // f at the far end.
    for (let at = 1; at < climbing.length; at += 1) {
      expect(climbing[at] ?? 0).toBeGreaterThan(climbing[at - 1] ?? 0);
    }
    expect(climbing[0]).toBeCloseTo(DYNAMIC_VELOCITY.pp, 5);
    expect(climbing[climbing.length - 1] ?? 0).toBeLessThan(DYNAMIC_VELOCITY.f);
  });

  it('keeps the levels a hairpin works out to itself', () => {
    const swelling = {
      ...twoBarExercise(),
      dynamicMarks: [
        { measureIndex: 0, offsetTicks: 0, level: 'p' as const, staffNumber: null },
        { measureIndex: 1, offsetTicks: 0, level: 'mp' as const, staffNumber: null, implied: true },
      ],
    };

    const printed = serializer.serialize(swelling);

    // The written p, and not the mp nobody wrote.
    expect([...printed.matchAll(/<dynamics>/g)]).toHaveLength(1);
  });

  it('puts a word back where its writer put it', () => {
    // Reported from Avatar, bar 59: a `rit.` printed on top of the metronome
    // mark. Both go above when nobody says otherwise, and we were saying
    // "above" for every word rather than carrying what the file said.
    const placed = {
      ...twoBarExercise(),
      tempoWords: [
        {
          measureIndex: 1,
          offsetTicks: 0,
          text: 'rit.',
          kind: 'ritardando' as const,
          placement: 'below' as const,
          offsetY: -40,
        },
      ],
    };

    const printed = serializer.serialize(placed);
    const { exercise } = importer.read(printed);

    expect(printed).toContain('placement="below"');
    expect(printed).toContain('default-y="-40"');
    expect(exercise.tempoWords[0]?.placement).toBe('below');
    expect(exercise.tempoWords[0]?.offsetY).toBe(-40);
  });

  it('keeps the numbers it worked out to itself', () => {
    // A gradual change is a run of small constant ones because that is the
    // only language the clock speaks; printing them turns one word into a
    // row of numbers.
    const slowing = {
      ...twoBarExercise(),
      tempoChanges: [
        { measureIndex: 0, offsetTicks: 0, tempoBpm: 60 },
        { measureIndex: 1, offsetTicks: 0, tempoBpm: 52, implied: true },
      ],
    };

    const printed = serializer.serialize(slowing);

    // The written sixty is there - twice, since the opening tempo is stated
    // with the attributes as well - and the fifty-two nobody wrote is not.
    expect(printed).toContain('<per-minute>60</per-minute>');
    expect(printed).not.toContain('52');
  });

  it('says nothing about loudness where the writer said nothing', () => {
    const { exercise } = importer.read(serializer.serialize(twoBarExercise()));

    expect(exercise.dynamicMarks).toEqual([]);
  });
});

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

  // Every preset against every rhythm, each generated, written and read back:
  // seconds of real work by design, and the default limit is five of them. It
  // had been passing with little to spare and failing whenever the machine was
  // busy, which is a test that reports the load rather than the code.
  it('recovers every built-in preset under every rhythm, triplets included', { timeout: 30_000 }, () => {
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

describe('making room for the beat', () => {
  /** One bar: a half and two quarters, where the beats are uneven on paper. */
  const uneven = twoBarExercise();

  it('writes nothing at all until it is asked to', () => {
    expect(serializer.serialize(uneven)).not.toMatch(UNSEEN_NOTE);
  });

  it('rules each bar by its own grid, and by nothing coarser', () => {
    const printed = serializer.serialize(uneven, { evenBars: true });

    // The fixture moves in quarters through its first bar and in halves
    // through its second, so that is what each is ruled by: four rests and
    // then two, every one of them marked not to be printed.
    const spacers = printed.match(UNSEEN_NOTES) ?? [];
    expect(spacers).toHaveLength(6);
    expect(printed).toContain(`<duration>${Duration.QUARTER.ticks}</duration>`);
    expect(printed).toContain(`<duration>${Duration.HALF.ticks}</duration>`);
  });

  it('keeps them out of the way of the voices the music uses', () => {
    const printed = serializer.serialize(uneven, { evenBars: true });
    const voices = uneven.staves.map((staff) => staff.voice);

    // One above every voice written, so it can collide with none of them.
    const spacer = /<voice>(\d+)<\/voice>/.exec(printed.match(UNSEEN_NOTES)?.[0] ?? '');
    expect(Number(spacer?.[1])).toBe(Math.max(...voices) + 1);
  });

  it('is a printing and not a file', () => {
    // Nothing in MusicXML says "this is scaffolding", so read back the room
    // would be rests. This printing therefore goes to the engraver and
    // nowhere else: what the library keeps and what the trainer announces is
    // the music, and the test for that is next door in the controller.
    expect(serializer.serialize(uneven)).not.toMatch(UNSEEN_NOTE);

    // And what it does say is only ever a rest - no pitch, nothing to play.
    const [spacer] = serializer.serialize(uneven, { evenBars: true }).match(UNSEEN_NOTES) ?? [];
    expect(spacer).toContain('<rest/>');
    expect(spacer).not.toContain('<pitch>');
  });
});

describe('what to call a piece', () => {
  /** A score whose header says nothing, with whatever credits are given. */
  function credited(credits: string, header = ''): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  ${header}
  ${credits}
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>24</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef></attributes>
      <note><rest/><duration>96</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
  }

  it('reads the name a score prints on its own first page', () => {
    // Six of his thirty-three files carry neither a work title nor a movement
    // title: they were laid out by hand and the name was typed onto the page
    // as a credit. Every one of them was called "Imported score" - in the
    // library, and in the corner of all thirty pages of the piece.
    const { exercise } = importer.read(
      credited('<credit page="1"><credit-words>Senbonzakura</credit-words></credit>'),
    );

    expect(exercise.title).toBe('Senbonzakura');
  });

  it('takes the credit that says it is the title, wherever it stands', () => {
    const { exercise } = importer.read(
      credited(
        '<credit page="1"><credit-words>Kurousa P</credit-words></credit>' +
          '<credit page="1"><credit-type>title</credit-type>' +
          '<credit-words>One Summer Day</credit-words></credit>',
      ),
    );

    expect(exercise.title).toBe('One Summer Day');
  });

  it('otherwise takes the first, which is where a title is printed', () => {
    // Above the composer and the arranger. Calling a piece by its arranger is
    // worse than calling it nothing.
    const { exercise } = importer.read(
      credited(
        '<credit page="1"><credit-words>The Sixth Station</credit-words></credit>' +
          '<credit page="1"><credit-words>Joe Hisaishi</credit-words></credit>',
      ),
    );

    expect(exercise.title).toBe('The Sixth Station');
  });

  it('ignores what is printed on a later page, that being a header', () => {
    const { exercise } = importer.read(
      credited('<credit page="4"><credit-words>Clair de Lune - 4</credit-words></credit>'),
    );

    expect(exercise.title).toBe('Imported score');
  });

  it('lets the header have the last word when it says anything', () => {
    const { exercise } = importer.read(
      credited(
        '<credit page="1"><credit-words>Typeset by hand</credit-words></credit>',
        '<work><work-title>Something Borrowed</work-title></work>',
      ),
    );

    expect(exercise.title).toBe('Something Borrowed');
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
    expect(exercise.staves[0]?.clefChanges).toEqual([
      { measureIndex: 1, offsetTicks: 0, clef: 'treble' },
    ]);

    // And it is written back at the head of the bar it takes effect in.
    const printed = serializer.serialize(exercise);
    const secondBar = printed.slice(printed.indexOf('<measure number="2"'));
    expect(secondBar).toMatch(/<attributes>\s*<clef number="1">\s*<sign>G<\/sign>/);
  });

/**
 * A staff whose upper voice holds while the lower one changes clef under it.
 *
 * Bar 36 of his Minecraft arrangement in miniature: the change back to the
 * bass falls in the middle of a chord the upper voice is holding, so the
 * voice this program writes the clef into has no boundary there at all.
 */
const heldOver = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>24</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time><staves>1</staves>
      <clef number="1"><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>48</duration>
      <voice>1</voice><type>half</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>48</duration>
      <voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>96</duration></backup>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration>
      <voice>2</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>24</duration>
      <voice>2</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>24</duration>
      <voice>2</voice><type>quarter</type><staff>1</staff></note>
      <attributes><clef number="1"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>24</duration>
      <voice>2</voice><type>quarter</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

  it('walks the cursor back for a clef that falls inside a held note', () => {
    // The voice a clef is written into may have no boundary where the change
    // happens. Written at the next one it came out a beat and a half late -
    // at the bar line - which is where his bar 36 was drawing it. So the
    // cursor goes back to the moment the writer chose and forward again,
    // which is how the file it was read from says it too.
    const { exercise } = importer.read(heldOver);
    const changes = exercise.staves[0]?.clefChanges;

    expect(changes).toEqual([
      { measureIndex: 0, offsetTicks: Duration.QUARTER.ticks * 3, clef: 'bass' },
    ]);

    const printed = serializer.serialize(exercise);

    expect(printed).toMatch(/<backup>\s*<duration>\d+<\/duration>\s*<\/backup>\s*<attributes>/);
    expect(importer.read(printed).exercise.staves[0]?.clefChanges).toEqual(changes);
  });

  it('measures the metre off the first bar where the file states none', () => {
    // His Bad Apple arrangement, written by MuseScore 1.3 with the time
    // signature hidden: no `<time>` element anywhere in it, and a hundred and
    // twenty-four bars refused for the want of two numbers the first bar
    // already answers. A bar is as long as the music in it.
    const untimed = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>12</divisions><key><fifths>0</fifths></key>
      <clef><sign>G</sign><line>2</line></clef></attributes>
      <note><rest/><duration>12</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration>
      <voice>1</voice><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>24</duration>
      <voice>1</voice><type>half</type></note>
    </measure>
  </part>
</score-partwise>`;
    const { exercise, warnings } = importer.read(untimed);

    expect(exercise.timeSignature.beats).toBe(4);
    expect(exercise.timeSignature.beatType).toBe(4);
    // And said out loud, because it is this program's reading rather than
    // the writer's: what cannot be read is how they would have spelled it.
    expect(warnings.map((one) => one.kind)).toContain('measured-metre');
  });

  it('reads a bar that is a whole number of quavers as quavers', () => {
    // Three eighths is not a whole number of crotchets, and 3/8 is a metre a
    // reader meets. Rounded to crotchets it would be neither the length of
    // the bar nor a metre anyone writes.
    const untimed = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>12</divisions><key><fifths>0</fifths></key>
      <clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>6</duration>
      <voice>1</voice><type>eighth</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>6</duration>
      <voice>1</voice><type>eighth</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>6</duration>
      <voice>1</voice><type>eighth</type></note>
    </measure>
  </part>
</score-partwise>`;
    const { exercise } = importer.read(untimed);

    expect(exercise.timeSignature.beats).toBe(3);
    expect(exercise.timeSignature.beatType).toBe(8);
  });

  it('follows a clef that changes twice inside one bar', () => {
    // Bar 36 of his Minecraft arrangement: the left hand crosses up for half
    // a beat and comes back before the bar is out. Read bar by bar the two
    // changes collapse into one at the bar line, the return is lost, and
    // every bar from there on is drawn in the wrong clef.
    const crossing = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>24</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time><staves>1</staves>
      <clef number="1"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>24</duration>
      <voice>1</voice><type>quarter</type><staff>1</staff></note>
      <attributes><clef number="1"><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration>
      <voice>1</voice><type>quarter</type><staff>1</staff></note>
      <attributes><clef number="1"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>48</duration>
      <voice>1</voice><type>half</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const { exercise } = importer.read(crossing);
    const staff = exercise.staves[0];
    if (staff === undefined) {
      throw new Error('the file has one staff');
    }

    expect(staff.clef).toBe('bass');
    expect(staff.clefChanges).toEqual([
      { measureIndex: 0, offsetTicks: Duration.QUARTER.ticks, clef: 'treble' },
      { measureIndex: 0, offsetTicks: Duration.HALF.ticks, clef: 'bass' },
    ]);

    // In force from where it is written, not from the bar line: the bar opens
    // and ends in the bass, and is in the treble only in between.
    expect(clefAt(staff, 0, 0)).toBe('bass');
    expect(clefAt(staff, 0, Duration.QUARTER.ticks)).toBe('treble');
    expect(clefAt(staff, 0, Duration.HALF.ticks)).toBe('bass');

    // Written back among the notes rather than at the head of the bar, which
    // is the format's way of saying where it happens - and read again
    // unchanged.
    const printed = serializer.serialize(exercise);
    expect(printed.indexOf('<sign>G</sign>')).toBeGreaterThan(printed.indexOf('<note>'));
    expect(importer.read(printed).exercise.staves[0]?.clefChanges).toEqual(staff.clefChanges);
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

  it('opens no group of articulations for a note that has none', () => {
    // A fermata is not one of them - it hangs off the notations directly - so a
    // note carrying only a fermata would otherwise be given an empty group.
    const held = note('C', 4, 96, 'whole', '<notations><fermata type="upright"/></notations>');
    const { exercise } = importer.read(scoreXml(held));

    expect(new MusicXmlSerializer().serialize(exercise)).not.toContain('<articulations>');
  });

  it('carries a staccato dot, and prints it again', () => {
    // The same kind of thing as the fermata and the comma, and dropped the same
    // way: sixty of them in his Barret's theme and not one reached the page, so
    // he was reading a photocopy with the articulation rubbed out. How much
    // shorter is the performer's, which is why it belongs on the page rather
    // than being turned into a length here. His: "barret theme doesn't have
    // 'dot' notes that make the note sound shorter, it was not imported".
    const marked = note(
      'C',
      4,
      96,
      'whole',
      '<notations><articulations><staccato/></articulations></notations>',
    );
    const { exercise } = importer.read(scoreXml(marked));

    const entry = exercise.staves[0]?.measures[0]?.entries[0];
    expect(entry).toMatchObject({ kind: 'note', staccato: true });

    expect(new MusicXmlSerializer().serialize(exercise)).toContain('<staccato/>');
  });

  it('keeps a dot and a comma on one note in one group', () => {
    // `articulations` is the group, and two of them side by side is not what
    // the format means by it.
    const marked = note(
      'C',
      4,
      96,
      'whole',
      '<notations><articulations><staccato/>' +
        '<breath-mark>comma</breath-mark></articulations></notations>',
    );
    const { exercise } = importer.read(scoreXml(marked));

    const printed = new MusicXmlSerializer().serialize(exercise);
    expect(printed).toContain('<staccato/>');
    expect(printed).toContain('<breath-mark');
    expect([...printed.matchAll(/<articulations>/g)]).toHaveLength(1);
  });

  it('keeps the dot on a note whose tie had to be dropped', () => {
    // A tie whose other end did not survive the import is let go of rather than
    // failing the whole file, and the note is built again to do it. Everything
    // the writer put on that note has to be built again with it.
    const dangling =
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>96</duration>' +
      '<tie type="start"/><voice>1</voice><type>whole</type>' +
      '<notations><tied type="start"/><articulations><staccato/></articulations>' +
      '</notations></note>';
    const { exercise } = importer.read(scoreXml(dangling));

    const entry = exercise.staves[0]?.measures[0]?.entries[0];
    expect(entry).toMatchObject({ kind: 'note', staccato: true, tiedForward: [] });
  });

  it('leaves a note the writer did not mark unmarked', () => {
    const { exercise } = importer.read(scoreXml(note('C', 4, 96, 'whole')));

    const entry = exercise.staves[0]?.measures[0]?.entries[0];
    expect(entry).toMatchObject({ kind: 'note', staccato: false });
    expect(new MusicXmlSerializer().serialize(exercise)).not.toContain('<articulations>');
  });

  it('draws the pedal the way the writer drew it', () => {
    // Notation the writer chose, like the beams and the stems. Rewritten as
    // the sign, a bracket the engraver lays out in twenty units became a
    // system of ninety-six - four times the height of any other on the page,
    // with three extra pages behind it - because it was being asked to draw
    // something nobody wrote. Two thousand of the reader's own pedal marks
    // are brackets and fewer than two hundred are signs.
    const bracket =
      '<direction placement="below"><direction-type>' +
      '<pedal type="start" line="yes"/></direction-type><staff>1</staff></direction>' +
      note('C', 4, 48, 'half') +
      '<direction placement="below"><direction-type>' +
      '<pedal type="stop" line="yes"/></direction-type><staff>1</staff></direction>' +
      note('D', 4, 48, 'half');
    const { exercise } = importer.read(scoreXml(bracket));

    expect(exercise.pedalMarks.map((mark) => mark.line)).toEqual([true, true]);

    const written = serializer.serialize(exercise);
    expect(written).toContain('line="yes"');
    expect(written).not.toContain('sign="yes"');
    expect(importer.read(written).exercise.pedalMarks).toEqual(exercise.pedalMarks);
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
      // Written as the "Ped." sign in this file, and kept as one.
      { measureIndex: 0, offsetTicks: 0, type: 'start', line: false },
      { measureIndex: 0, offsetTicks: Duration.HALF.ticks, type: 'stop', line: false },
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

  it('costs the bar nothing at all', () => {
    // The whole point. Given real time it has to come from somewhere, and
    // both places are wrong: out of the note it leans on moves that note off
    // its beat, and out of the note before shortens something the writer did
    // not shorten. As an ornament the question does not arise.
    const { exercise } = importer.read(bar(grace('G', 4)));

    expect(() => validateExercise(exercise)).not.toThrow();
    const q = Duration.QUARTER.ticks;
    const entries = exercise.staves[0]?.measures[0]?.entries ?? [];
    expect(entries.map((entry) => entry.duration.ticks)).toEqual([q, q, q * 2]);
    expect(buildTimeline(exercise).steps.map((step) => step.onsetTicks)).toEqual([0, q, q * 2]);
  });

  it('is carried on the note it leans on', () => {
    const { exercise, warnings } = importer.read(bar(grace('G', 4)));

    const entries = exercise.staves[0]?.measures[0]?.entries ?? [];
    const host = entries[1];
    expect(host?.kind).toBe('note');
    const graces = host?.kind === 'note' ? host.graces : [];
    expect(graces).toHaveLength(1);
    expect(graces[0]?.pitches.map((pitch) => pitch.toString())).toEqual(['G4']);
    // The stroke through the stem, which the file asked for.
    expect(graces[0]?.slashed).toBe(true);
    expect(warnings.map((warning) => warning.kind)).toContain('grace-notes');
  });

  it('may be played and is never demanded', () => {
    const { exercise } = importer.read(bar(grace('G', 4)));
    const steps = buildTimeline(exercise).steps;

    expect(demands(exercise)).toEqual([
      [Pitch.parse('C4').midi],
      [Pitch.parse('A4').midi],
      [Pitch.parse('B4').midi],
    ]);
    // Offered at the note it decorates, and nowhere else.
    expect(steps.map((step) => step.ornamentMidi)).toEqual([
      [],
      [Pitch.parse('G4').midi],
      [],
    ]);
  });

  it('is kept where there is nothing in front of it', () => {
    // Nothing has to be taken from anywhere, so the case that used to drop
    // the ornament no longer exists.
    const { exercise } = importer.read(
      scoreXml(grace('G', 4) + note('A', 4, 24, 'quarter') + note('B', 4, 72, 'half', '<dot/>')),
    );

    expect(() => validateExercise(exercise)).not.toThrow();
    const first = exercise.staves[0]?.measures[0]?.entries[0];
    expect(first?.kind === 'note' ? first.graces.length : 0).toBe(1);
    expect(buildTimeline(exercise).steps[0]?.onsetTicks).toBe(0);
    expect(demands(exercise)[0]).toEqual([Pitch.parse('A4').midi]);
  });

  it('is kept where what is before it is far too short to give any', () => {
    const { exercise } = importer.read(
      scoreXml(
        note('C', 4, 6, '16th') +
          grace('G', 4) +
          note('A', 4, 18, 'eighth', '<dot/>') +
          note('B', 4, 72, 'half', '<dot/>'),
      ),
    );

    expect(() => validateExercise(exercise)).not.toThrow();
    expect(demands(exercise)).toHaveLength(3);
    const host = exercise.staves[0]?.measures[0]?.entries[1];
    expect(host?.kind === 'note' ? host.graces.length : 0).toBe(1);
  });

  it('is one press of two keys when they are marked as a chord', () => {
    const { exercise } = importer.read(bar(grace('G', 4) + grace('B', 4, '<chord/>')));

    const host = exercise.staves[0]?.measures[0]?.entries[1];
    const graces = host?.kind === 'note' ? host.graces : [];
    expect(graces).toHaveLength(1);
    expect(graces[0]?.pitches.map((pitch) => pitch.toString())).toEqual(['G4', 'B4']);
  });

  it('keeps two of them in the order they are played', () => {
    const { exercise } = importer.read(bar(grace('G', 4) + grace('A', 4)));

    const host = exercise.staves[0]?.measures[0]?.entries[1];
    const graces = host?.kind === 'note' ? host.graces : [];
    expect(graces.map((one) => one.pitches.map((pitch) => pitch.toString()).join(''))).toEqual([
      'G4',
      'A4',
    ]);
    // And the bar is still four beats of three notes.
    const q = Duration.QUARTER.ticks;
    expect(buildTimeline(exercise).steps.map((step) => step.onsetTicks)).toEqual([0, q, q * 2]);
  });

  it('survives being written out and read back', () => {
    const { exercise } = importer.read(bar(grace('G', 4) + grace('B', 4, '<chord/>')));
    const { exercise: back } = importer.read(serializer.serialize(exercise));

    const host = back.staves[0]?.measures[0]?.entries[1];
    const graces = host?.kind === 'note' ? host.graces : [];
    expect(graces).toHaveLength(1);
    expect(graces[0]?.pitches.map((pitch) => pitch.toString())).toEqual(['G4', 'B4']);
    expect(graces[0]?.slashed).toBe(true);
  });

  it('says once what it did, rather than once for every bar', () => {
    const { warnings } = importer.read(bar(grace('G', 4)));

    expect(warnings.filter((warning) => warning.kind === 'grace-notes')).toHaveLength(1);
  });
});
