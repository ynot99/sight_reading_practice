import { DOMParser } from '@xmldom/xmldom';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { RhythmProfileRegistry } from '../../src/domain/generation/RhythmProfile.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry, silenceEntry, validateExercise, type Exercise } from '../../src/domain/model/Exercise.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { barId, printedAtEachStep } from '../../src/domain/notation/printedIds.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { readThePage, type PageLayout, type SvgNode } from '../../src/infrastructure/rendering/verovio/pageLayout.js';
import { VerovioCore, type PageShape } from '../../src/infrastructure/rendering/verovio/VerovioCore.js';
import { allowTheEngraverItsTime } from '../support/verovioStage.js';
import {
  arpeggiatedExercise,
  bar,
  beamedSixteenths,
  compoundBarExercise,
  longExercise,
  offBeatAfterALongNote,
  oneHandOpensAlone,
  oneHandWalksUnderAHeldNote,
  p,
  partialVoiceExercise,
  staccatoInTheBass,
  tiedExercise,
  twoBarExercise,
} from '../support/fixtures.js';

/**
 * The contract between our timeline and the page Verovio draws.
 *
 * The printed MusicXML and the matcher's timeline are both derived from one
 * exercise, and the marker, the notes played and the page turns all stand on
 * the two agreeing. OSMD's cursor made the question "does it stop as often as
 * we step"; with Verovio the steps are found by the names their notes are
 * printed under, so the question is whether the names and the drawing agree:
 * every note and rest a step names is drawn, everything Verovio draws is some
 * step's (a grace note excepted - an ornament takes no place), every step has
 * something drawn to stand on, the steps go forward across the pages, and
 * every bar is drawn once, in order.
 */
let core: VerovioCore;
beforeAll(async () => {
  core = await VerovioCore.start();
});
allowTheEngraverItsTime();

const serializer = new MusicXmlSerializer();
const RHYTHMS = new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES);
/** Several systems to a page and several pages to a long piece. */
const SHAPE: PageShape = { pageWidth: 2200, pageHeight: 1400, scale: 50 };

/** Both hands active, so a rhythm profile shows up on two staves at once. */
const WIDE_PRESET = (() => {
  const preset = BUILT_IN_PRESETS.find((candidate) => candidate.id === 'wide-grand-staff');
  if (preset === undefined) {
    throw new Error('expected the wide grand staff preset');
  }
  return preset;
})();

interface Agreement {
  /** Names a step gives that the page does not draw. */
  readonly missing: readonly string[];
  /** Notes and rests the page draws that no step names. */
  readonly strays: readonly string[];
  /** Ornaments a step names, which take no place and so belong to none. */
  readonly ornaments: readonly string[];
  /** Steps with nothing drawn at all to stand on. */
  readonly unplaced: readonly number[];
  /** Steps that stand no further on than the one before them. */
  readonly backwards: readonly number[];
  /** The bars, in the order the pages draw them. */
  readonly bars: readonly string[];
}

/** Lays the exercise out and reads every page back. */
function pagesOf(exercise: Exercise, evenBars = false): PageLayout[] {
  const count = core.load(serializer.serialize(exercise, { evenBars }), SHAPE);
  return Array.from({ length: count }, (_, index) =>
    readThePage(new DOMParser().parseFromString(core.page(index + 1), 'image/svg+xml') as unknown as SvgNode),
  );
}

function agreementOf(exercise: Exercise, evenBars = false): Agreement {
  const steps = printedAtEachStep(buildTimeline(exercise));
  const pages = pagesOf(exercise, evenBars);
  const heads = new Map<string, number>();
  const barAt = new Map<string, readonly [number, number]>();
  const bars: string[] = [];
  for (const [page, layout] of pages.entries()) {
    for (const [name, head] of layout.heads) {
      heads.set(name, head.x);
    }
    for (const [system, drawn] of layout.systems.entries()) {
      for (const each of drawn.bars) {
        bars.push(each.id);
        barAt.set(each.id, [page, system]);
      }
    }
  }
  const named = new Set(steps.flatMap((step) => step.printed.map((here) => here.id)));
  const missing = [...named].filter((name) => !heads.has(name));
  const strays = [...heads.keys()].filter((name) => /^[nr]/.test(name) && !named.has(name));
  const ornaments = [...named].filter((name) => /^g/.test(name));
  const unplaced: number[] = [];
  const backwards: number[] = [];
  let before: readonly [number, number, number] | null = null;
  for (const [index, step] of steps.entries()) {
    const xs = step.printed.map((here) => heads.get(here.id)).filter((x): x is number => x !== undefined);
    const where = barAt.get(step.barId);
    if (xs.length === 0 || where === undefined) {
      unplaced.push(index);
      continue;
    }
    const here = [where[0], where[1], Math.min(...xs)] as const;
    if (before !== null && !isFurtherOn(here, before)) {
      backwards.push(index);
    }
    before = here;
  }
  return { missing, strays, ornaments, unplaced, backwards, bars };
}

/** Page, then system, then across. */
function isFurtherOn(
  here: readonly [number, number, number],
  before: readonly [number, number, number],
): boolean {
  for (let at = 0; at < 3; at += 1) {
    const a = here[at] ?? 0;
    const b = before[at] ?? 0;
    if (a !== b) {
      return a > b;
    }
  }
  return false;
}

/** What agreement looks like for an exercise of this many bars. */
function agreeing(bars: number): Agreement {
  return {
    missing: [],
    strays: [],
    ornaments: [],
    unplaced: [],
    backwards: [],
    bars: Array.from({ length: bars }, (_, index) => barId(index)),
  };
}

function barsOf(exercise: Exercise): number {
  return exercise.staves[0]?.measures.length ?? 0;
}

/** The first bar of the two-bar fixture's treble replaced with this one. */
function withTrebleBar(first: ReturnType<typeof bar>): Exercise {
  const base = twoBarExercise();
  const [treble, bass] = base.staves;
  if (treble === undefined || bass === undefined) {
    throw new Error('expected two staves');
  }
  const exercise = { ...base, staves: [{ ...treble, measures: [first, ...treble.measures.slice(1)] }, bass] };
  validateExercise(exercise);
  return exercise;
}

describe('Verovio and our timeline agree on every step', () => {
  it('on a grand staff exercise', () => {
    const exercise = twoBarExercise();

    expect(agreementOf(exercise)).toEqual(agreeing(2));
  });

  it('with the room the ruler asks for in every bar, which draws nothing and is no step', () => {
    // Rests nobody sees, at the beat, so the beats stand evenly across the
    // bar. Each is an event: a place on the page that is not a step would put
    // every marker of the piece out by one.
    const exercise = twoBarExercise();
    expect(serializer.serialize(exercise, { evenBars: true })).not.toBe(serializer.serialize(exercise));

    expect(agreementOf(exercise, true)).toEqual(agreeing(2));
  });

  it('on a long piece, across systems and pages', () => {
    const exercise = longExercise({ bars: 120 });
    expect(pagesOf(exercise).length).toBeGreaterThan(1);

    expect(agreementOf(exercise)).toEqual(agreeing(120));
  });

  it('on every built-in preset, in three-four and two flats', () => {
    for (const preset of BUILT_IN_PRESETS) {
      const exercise = preset.generator.generate({
        measures: 4,
        timeSignature: new TimeSignature(3, 4),
        key: KeySignature.major(-2),
        tempoBpm: 80,
        rhythm: RHYTHMS.get(preset.defaults.rhythmProfileId),
        seed: 777,
      });

      expect({ preset: preset.id, ...agreementOf(exercise) }).toEqual({ preset: preset.id, ...agreeing(4) });
    }
  });

  it('under every rhythm profile, in four-four and six-eight', () => {
    // Sixteenths halve the distance between onsets and bring beaming with
    // them, which is where a drawing and a timeline could part company.
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

        expect({ profile: profile.id, time: timeSignature.toString(), ...agreementOf(exercise) }).toEqual({
          profile: profile.id,
          time: timeSignature.toString(),
          ...agreeing(2),
        });
      }
    }
  });

  it('on triplets', () => {
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
    expect(
      exercise.staves.some((staff) =>
        staff.measures.some((measure) => measure.entries.some((entry) => entry.duration.isTuplet)),
      ),
    ).toBe(true);

    expect(agreementOf(exercise)).toEqual(agreeing(4));
  });

  it('on the short values imported music is written in', () => {
    const exercise = withTrebleBar(
      bar(
        noteEntry(p('C4'), Duration.HALF),
        noteEntry(p('D4'), Duration.QUARTER),
        noteEntry(p('E4'), Duration.EIGHTH),
        noteEntry(p('F4'), Duration.SIXTEENTH),
        noteEntry(p('G4'), Duration.of('32nd')),
        noteEntry(p('A4'), Duration.of('64th')),
        noteEntry(p('B4'), Duration.of('64th')),
      ),
    );

    expect(agreementOf(exercise)).toEqual(agreeing(2));
  });

  it('on seven in the time of four', () => {
    const seven = Duration.of('16th', 0, { actual: 7, normal: 4 });
    const exercise = withTrebleBar(
      bar(
        ...['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'].map((name) => noteEntry(p(name), seven)),
        noteEntry(p('C5'), Duration.DOTTED_HALF),
      ),
    );

    expect(agreementOf(exercise)).toEqual(agreeing(2));
  });

  it('across a change of metre', () => {
    const base = twoBarExercise();
    const [treble, bass] = base.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('expected two staves');
    }
    const exercise: Exercise = {
      ...base,
      timeChanges: [{ measureIndex: 1, timeSignature: new TimeSignature(3, 4) }],
      staves: [
        {
          ...treble,
          measures: [
            bar(noteEntry(p('C4'), Duration.WHOLE)),
            bar(noteEntry(p('D4'), Duration.QUARTER), noteEntry(p('E4'), Duration.QUARTER), noteEntry(p('F4'), Duration.QUARTER)),
          ],
        },
        { ...bass, measures: [bar(noteEntry(p('C3'), Duration.WHOLE)), bar(noteEntry(p('G2'), Duration.DOTTED_HALF))] },
      ],
    };
    validateExercise(exercise);

    expect(agreementOf(exercise)).toEqual(agreeing(2));
  });

  it('when two voices share a staff', () => {
    const base = twoBarExercise();
    const [treble, bass] = base.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('expected two staves');
    }
    const exercise = { ...base, staves: [treble, { ...bass, staffNumber: 1, voice: 3, clef: 'treble' as const }, bass] };

    expect(agreementOf(exercise)).toEqual(agreeing(2));
  });

  it('when a voice is absent for part of a bar, which draws nothing there', () => {
    const exercise = partialVoiceExercise([
      silenceEntry(Duration.EIGHTH),
      noteEntry(p('G3'), Duration.HALF),
      silenceEntry(Duration.DOTTED_QUARTER),
    ]);

    // Four quarters and the one place only the inner voice moves.
    expect(buildTimeline(exercise).length).toBe(5);
    expect(agreementOf(exercise)).toEqual(agreeing(barsOf(exercise)));
  });

  it('on an ornament, which is drawn and given no place', () => {
    const exercise = withTrebleBar(
      bar(
        noteEntry(p('C4'), Duration.QUARTER, [], [], null, false, {
          graces: [{ pitches: [p('B3')], duration: Duration.of('16th'), slashed: true }],
        }),
        noteEntry(p('D4'), Duration.QUARTER),
        noteEntry(p('E4'), Duration.QUARTER),
        noteEntry(p('F4'), Duration.QUARTER),
      ),
    );

    const graces = pagesOf(exercise).flatMap((page) => [...page.heads.keys()].filter((name) => name.startsWith('g')));
    expect(graces).toHaveLength(1);
    expect(agreementOf(exercise)).toEqual(agreeing(2));
  });

  it('on a tie, whose held note is drawn and names a step of its own', () => {
    const exercise = tiedExercise();

    expect(agreementOf(exercise)).toEqual(agreeing(barsOf(exercise)));
  });

  it.each([
    ['a rolled chord', arpeggiatedExercise],
    ['beamed sixteenths', beamedSixteenths],
    ['a compound bar', compoundBarExercise],
    ['an off-beat after a long note', offBeatAfterALongNote],
    ['one hand opening alone', oneHandOpensAlone],
    ['staccato in the bass', staccatoInTheBass],
    ['one hand walking under a held note', oneHandWalksUnderAHeldNote],
  ])('on %s', (_, make) => {
    const exercise = make();

    expect(agreementOf(exercise)).toEqual(agreeing(barsOf(exercise)));
  });
});
