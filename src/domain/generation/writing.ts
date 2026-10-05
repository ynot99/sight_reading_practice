import type {
  DynamicHairpin,
  DynamicLevel,
  DynamicMark,
  Exercise,
  Measure,
  MusicalEntry,
  NoteEntry,
  StaffPart,
  TempoChange,
  TempoWord,
} from '../model/Exercise.js';
import { DYNAMIC_LEVELS, measureOf } from '../model/Exercise.js';
import { Duration } from '../model/Duration.js';
import type { Alteration, Pitch } from '../model/Pitch.js';
import { withFermatasHeld } from '../notation/fermatas.js';
import type { Rng } from './Rng.js';

/**
 * What a page is written with beyond its notes and their rhythm.
 *
 * Asked for by the grade being read rather than by the material: the same
 * broken chords are a Grade 4 page with chromatic notes and a pause in them,
 * and a plainer one below. Every field left out is a page without it.
 */
export interface Writing {
  /** Now and then a note a semitone off the scale, leaning by step into the next. */
  readonly chromatic?: boolean;
  /** Bars of short notes played detached. */
  readonly staccato?: boolean;
  /** Now and then a downbeat leant on. */
  readonly accents?: boolean;
  /** Now and then a long note held with weight. */
  readonly tenuto?: boolean;
  /** The levels a page may be marked with; none where empty. */
  readonly dynamics?: readonly DynamicLevel[];
  /** Getting louder or quieter into a change of level. */
  readonly hairpins?: boolean;
  /** A pause over the last notes. */
  readonly pauses?: boolean;
  /** The last bar slowing down, and saying so. */
  readonly slowingAtTheEnd?: boolean;
}

/** How often each mark is written where it may be. */
const CHROMATIC_SHARE = 0.15;
const STACCATO_BARS_SHARE = 0.3;
const ACCENT_SHARE = 0.15;
const TENUTO_SHARE = 0.3;

/** How much of its speed each beat of a slowing last bar gives up. */
const SLOWING_PER_BEAT = 0.1;

/**
 * The exercise as the grade writes it.
 *
 * Drawn from the generation's own random source after the notes, so a page
 * with the same seed and the same writing is the same page, and a page with
 * none is exactly what it was before any of this existed.
 */
export function written(exercise: Exercise, writing: Writing, rng: Rng): Exercise {
  let staves = exercise.staves;
  if (writing.chromatic === true) {
    staves = staves.map((staff) => ({ ...staff, measures: leaningChromatically(staff.measures, rng) }));
  }
  if (writing.staccato === true || writing.accents === true || writing.tenuto === true) {
    staves = staves.map((staff) => ({ ...staff, measures: articulated(staff, writing, rng) }));
  }
  let out: Exercise = { ...exercise, staves };
  const levels = [...new Set(writing.dynamics ?? [])].sort(
    (left, right) => DYNAMIC_LEVELS.indexOf(left) - DYNAMIC_LEVELS.indexOf(right),
  );
  if (levels.length > 0) {
    out = withDynamics(out, levels, writing.hairpins === true, rng);
  }
  if (writing.slowingAtTheEnd === true) {
    out = slowingAtTheEnd(out);
  }
  if (writing.pauses === true) {
    out = withFermatasHeld(pausedAtTheEnd(out));
  }
  return out;
}

/** One note of a line, where it is, so it can be written back. */
interface Place {
  readonly measure: number;
  readonly entry: number;
  readonly note: NoteEntry;
  readonly pitch: Pitch;
}

function lineOf(measures: readonly Measure[]): Place[] {
  const line: Place[] = [];
  measures.forEach((measure, measureIndex) => {
    measure.entries.forEach((entry, entryIndex) => {
      const pitch = entry.kind === 'note' && entry.pitches.length === 1 ? entry.pitches[0] : undefined;
      if (entry.kind === 'note' && pitch !== undefined) {
        line.push({ measure: measureIndex, entry: entryIndex, note: entry, pitch });
      }
    });
  });
  return line;
}

/** The measures with some of their entries replaced. */
function rewritten(
  measures: readonly Measure[],
  changed: ReadonlyMap<string, MusicalEntry>,
): Measure[] {
  return measures.map((measure, measureIndex) =>
    measureOf(measure.entries.map((entry, entryIndex) => changed.get(`${measureIndex}:${entryIndex}`) ?? entry)),
  );
}

/**
 * A line with now and then a chromatic note leaning into the next by step.
 *
 * Only between two notes a whole tone apart - in a scale that is two notes
 * a step apart - so the note pushed a semitone towards its neighbour is a
 * half step from it: F sharp to G, B flat to A, which is how a chromatic note
 * is met in the music of these grades. A note pushed past one sharp or one
 * flat is left alone, which is also every note the minor's own sharpening
 * has already raised; never either end of a tie, and never two in a row.
 */
function leaningChromatically(measures: readonly Measure[], rng: Rng): Measure[] {
  const line = lineOf(measures);
  const changed = new Map<string, MusicalEntry>();
  let lastChanged = -2;
  line.forEach((place, at) => {
    const next = line[at + 1];
    const before = line[at - 1];
    if (next === undefined || at === lastChanged + 1) {
      return;
    }
    const { pitch } = place;
    const tied = place.note.tiedForward.length > 0 || (before?.note.tiedForward.length ?? 0) > 0;
    const steps = next.pitch.diatonicIndex - pitch.diatonicIndex;
    const tone = Math.abs(next.pitch.midi - pitch.midi) === 2;
    if (tied || !tone) {
      return;
    }
    const alter = pitch.alter + steps;
    if ((alter !== -1 && alter !== 0 && alter !== 1) || !rng.bool(CHROMATIC_SHARE)) {
      return;
    }
    lastChanged = at;
    changed.set(`${place.measure}:${place.entry}`, {
      ...place.note,
      pitches: [pitch.withAlteration(alter as Alteration)],
    });
  });
  return rewritten(measures, changed);
}

/**
 * The staff's notes marked: some bars detached, some downbeats leant on, some
 * long notes held with weight. One mark to a note.
 */
function articulated(staff: StaffPart, writing: Writing, rng: Rng): Measure[] {
  return staff.measures.map((measure) => {
    const detached = writing.staccato === true && rng.bool(STACCATO_BARS_SHARE);
    let offset = 0;
    let heldFromTheLast = false;
    const entries = measure.entries.map((entry): MusicalEntry => {
      const at = offset;
      offset += entry.duration.ticks;
      if (entry.kind !== 'note') {
        heldFromTheLast = false;
        return entry;
      }
      const tied = entry.tiedForward.length > 0 || heldFromTheLast;
      heldFromTheLast = entry.tiedForward.length > 0;
      if (tied) {
        return entry;
      }
      if (detached && entry.duration.ticks < Duration.HALF.ticks) {
        return { ...entry, staccato: true };
      }
      if (writing.accents === true && at === 0 && rng.bool(ACCENT_SHARE)) {
        return { ...entry, accent: true };
      }
      if (writing.tenuto === true && entry.duration.ticks >= Duration.HALF.ticks && rng.bool(TENUTO_SHARE)) {
        return { ...entry, tenuto: true };
      }
      return entry;
    });
    return measureOf(entries);
  });
}

/**
 * A level at the start, and from four bars on a second one halfway, reached
 * by a hairpin where hairpins are written.
 */
function withDynamics(
  exercise: Exercise,
  levels: readonly DynamicLevel[],
  hairpins: boolean,
  rng: Rng,
): Exercise {
  const bars = exercise.staves[0]?.measures.length ?? 0;
  const opening = rng.pick(levels);
  const marks: DynamicMark[] = [{ measureIndex: 0, offsetTicks: 0, level: opening, staffNumber: null }];
  const wedges: DynamicHairpin[] = [];
  const others = levels.filter((level) => level !== opening);
  if (bars >= 4 && others.length > 0) {
    const halfway = Math.floor(bars / 2);
    const then = rng.pick(others);
    marks.push({ measureIndex: halfway, offsetTicks: 0, level: then, staffNumber: null });
    if (hairpins) {
      const louder = DYNAMIC_LEVELS.indexOf(then) > DYNAMIC_LEVELS.indexOf(opening);
      wedges.push({
        measureIndex: halfway - 1,
        offsetTicks: 0,
        kind: louder ? 'crescendo' : 'diminuendo',
        untilMeasureIndex: halfway,
        untilOffsetTicks: 0,
        staffNumber: null,
      });
    }
  }
  return { ...exercise, dynamicMarks: marks, hairpins: wedges };
}

/** The last bar slowing beat by beat, with `rit.` over it. */
function slowingAtTheEnd(exercise: Exercise): Exercise {
  const last = (exercise.staves[0]?.measures.length ?? 0) - 1;
  if (last < 0) {
    return exercise;
  }
  const metre = exercise.timeSignature;
  const word: TempoWord = { measureIndex: last, offsetTicks: 0, text: 'rit.', kind: 'ritardando' };
  const changes: TempoChange[] = [];
  for (let beat = 1; beat < metre.pulsesPerMeasure; beat += 1) {
    changes.push({
      measureIndex: last,
      offsetTicks: beat * metre.ticksPerPulse,
      tempoBpm: Math.round(exercise.tempoBpm * (1 - SLOWING_PER_BEAT * beat)),
      implied: true,
    });
  }
  return {
    ...exercise,
    tempoWords: [...exercise.tempoWords, word],
    tempoChanges: [...exercise.tempoChanges, ...changes],
  };
}

/** A pause over the last note of every staff that ends on one. */
function pausedAtTheEnd(exercise: Exercise): Exercise {
  return {
    ...exercise,
    staves: exercise.staves.map((staff) => {
      const lastBar = staff.measures.at(-1);
      const lastEntry = lastBar?.entries.at(-1);
      if (lastBar === undefined || lastEntry === undefined || lastEntry.kind !== 'note') {
        return staff;
      }
      const ending = measureOf([...lastBar.entries.slice(0, -1), { ...lastEntry, fermata: true }]);
      return { ...staff, measures: [...staff.measures.slice(0, -1), ending] };
    }),
  };
}
