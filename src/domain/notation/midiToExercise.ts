import { DIVISIONS_PER_QUARTER, Duration, type NoteTypeName } from '../model/Duration.js';
import { DomainError } from '../../shared/errors.js';
import type { Exercise, MusicalEntry, PedalMark, StaffPart } from '../model/Exercise.js';
import { measureOf, noteEntry, restEntry, validateExercise } from '../model/Exercise.js';
import { KeySignature } from '../model/KeySignature.js';
import { Pitch } from '../model/Pitch.js';
import { TimeSignature } from '../model/TimeSignature.js';
import { splitIntoRests } from '../generation/RhythmFiller.js';
import type { MidiFileDocument, MidiFileNote } from '../midi/readMidiFile.js';
import type { ImportWarning, ImportedScore } from './MusicXmlParser.js';

export interface MidiImportOptions {
  /**
   * Pitch the hands are divided at when the file does not divide them.
   *
   * Middle C, which is where a pianist would draw it and what every teaching
   * edition assumes. Only used when the file has a single track: a writer
   * that separated the staves has already answered this better than any rule
   * could.
   */
  readonly splitAtMidi?: number;
}

const DEFAULT_SPLIT_MIDI = 60;
const RIGHT_HAND = 1;
const LEFT_HAND = 2;

/**
 * The finest ordinary value a performance is read at, in divisions.
 *
 * A sixteenth, and it stays one however short a value can be *written*: see
 * {@link PLAYED_NOTE_TYPES}. Everything a plain-valued bar is made of is a
 * whole number of these.
 */
const PLAIN_GRID = Duration.SIXTEENTH.ticks;

/** How a beat is divided: into halves, or into thirds. */
type BeatGrid = 'plain' | 'triplet';

/** A chord: everything struck at one instant on one staff, and how long for. */
interface Segment {
  readonly startTicks: number;
  readonly endTicks: number;
  readonly midis: readonly number[];
}

function snap(ticks: number, grid: number): number {
  return Math.round(ticks / grid) * grid;
}

/**
 * How fine a grid a *performance* is measured against.
 *
 * Deliberately shorter than what can be notated. A written score says what it
 * means and is read down to sixty-fourths; a recording only lands near a grid,
 * and offering finer ones does not read the playing more truthfully - it turns
 * the unevenness of a hand into notation, and every grid added is another
 * answer for a beat to be mistaken for.
 */
const PLAYED_NOTE_TYPES: readonly NoteTypeName[] = ['whole', 'half', 'quarter', 'eighth', '16th'];

/**
 * The finest triplet division of a beat, in divisions.
 *
 * The *finest*, not a third: a beat played in sixes is as much a triplet beat
 * as one played in threes, and measuring it against thirds alone made it look
 * no better than the ordinary grid - so a beat of six lost the tie and was
 * written as sixteenths, which is a different piece of music.
 */
function tripletGridFor(ticksPerBeat: number): number | null {
  const units = PLAYED_NOTE_TYPES.map((type) => Duration.triplet(type).ticks)
    .filter((ticks) => ticks > 0 && ticksPerBeat % ticks === 0)
    .sort((left, right) => left - right);
  return units[0] ?? null;
}

/** Every triplet value that can sit inside one beat, longest first. */
function tripletVocabulary(ticksPerBeat: number): Duration[] {
  return PLAYED_NOTE_TYPES.map((type) => Duration.triplet(type))
    .filter((value) => value.ticks <= ticksPerBeat)
    .sort((left, right) => right.ticks - left.ticks);
}

/**
 * Which grid each beat of the piece was played on.
 *
 * A performance lands near a grid rather than on one, and *which* grid is the
 * question a notation program answers before any other: three notes in a beat
 * are a triplet, four are sixteenths, and the difference is not recoverable
 * afterwards. Asked beat by beat because a piece changes its mind - a bar of
 * triplets sits happily beside a bar of sixteenths, and one answer for the
 * whole piece would wreck whichever half it got wrong.
 *
 * The measure is total distance: whichever grid the beat's own attacks sit
 * closer to is the one it was written on. A beat with nothing in it is plain,
 * because nothing is asking otherwise.
 */
function gridsByBeat(
  ticks: readonly number[],
  ticksPerBeat: number,
  beats: number,
): BeatGrid[] {
  const triplet = tripletGridFor(ticksPerBeat);
  const byBeat = new Map<number, number[]>();
  for (const tick of ticks) {
    const beat = Math.floor(tick / ticksPerBeat);
    const bucket = byBeat.get(beat) ?? [];
    bucket.push(tick - beat * ticksPerBeat);
    byBeat.set(beat, bucket);
  }

  return Array.from({ length: beats }, (_, beat) => {
    const offsets = byBeat.get(beat) ?? [];
    if (triplet === null || offsets.length === 0) {
      return 'plain' as BeatGrid;
    }
    const cost = (grid: number): number =>
      offsets.reduce((total, offset) => total + Math.abs(offset - snap(offset, grid)), 0);
    return cost(triplet) < cost(PLAIN_GRID) ? 'triplet' : 'plain';
  });
}

/** Pulls one tick onto the grid the beat it falls in was written on. */
function snapToBeat(
  tick: number,
  grids: readonly BeatGrid[],
  ticksPerBeat: number,
  tripletTicks: number,
): number {
  const beat = Math.min(grids.length - 1, Math.max(0, Math.floor(tick / ticksPerBeat)));
  const grid = grids[beat] === 'triplet' ? tripletTicks : PLAIN_GRID;
  const within = snap(tick - beat * ticksPerBeat, grid);
  return beat * ticksPerBeat + within;
}

/**
 * Which staff each note belongs to.
 *
 * A file that separated its tracks has already made this decision, and
 * remaking it from pitch would undo the answer of whoever wrote it - a left
 * hand that climbs above middle C is ordinary, and splitting there would
 * throw it onto the other stave mid-phrase. Only where there is nothing to
 * read is the pitch rule used.
 */
function assignStaves(
  notes: readonly MidiFileNote[],
  splitAtMidi: number,
): { readonly byNote: ReadonlyMap<MidiFileNote, number>; readonly fromPitch: boolean } {
  const tracks = new Map<number, MidiFileNote[]>();
  for (const note of notes) {
    const bucket = tracks.get(note.track) ?? [];
    bucket.push(note);
    tracks.set(note.track, bucket);
  }

  const byNote = new Map<MidiFileNote, number>();
  const carrying = [...tracks.entries()].filter(([, bucket]) => bucket.length > 0);

  if (carrying.length >= 2) {
    // The two busiest, highest first: a piano file may also carry a click or
    // an empty conductor track, and those are not hands.
    const ranked = carrying
      .slice()
      .sort((left, right) => right[1].length - left[1].length)
      .slice(0, 2)
      .sort((left, right) => averagePitch(right[1]) - averagePitch(left[1]));
    const [high, low] = ranked;
    if (high !== undefined && low !== undefined) {
      for (const note of high[1]) {
        byNote.set(note, RIGHT_HAND);
      }
      for (const note of low[1]) {
        byNote.set(note, LEFT_HAND);
      }
      // Anything on a third track still has to go somewhere it can be played.
      for (const note of notes) {
        if (!byNote.has(note)) {
          byNote.set(note, note.midi < splitAtMidi ? LEFT_HAND : RIGHT_HAND);
        }
      }
      return { byNote, fromPitch: false };
    }
  }

  for (const note of notes) {
    byNote.set(note, note.midi < splitAtMidi ? LEFT_HAND : RIGHT_HAND);
  }
  return { byNote, fromPitch: true };
}

function averagePitch(notes: readonly MidiFileNote[]): number {
  return notes.length === 0
    ? 0
    : notes.reduce((sum, note) => sum + note.midi, 0) / notes.length;
}

/**
 * One staff's notes as chords that never overlap.
 *
 * A chord runs until the next attack on the same staff or until its own notes
 * stop, whichever comes first. That is one voice where the music may have had
 * two - a held bass under a moving line is cut where the line moves - and it
 * is the deliberate limit of reading a performance rather than a score: MIDI
 * records which keys went down and when, and says nothing whatever about
 * which line they belonged to. Every pitch and every attack survives; what is
 * lost is how long some of them were *written* to be held.
 */
function segmentsFor(notes: readonly MidiFileNote[]): Segment[] {
  const byOnset = new Map<number, MidiFileNote[]>();
  for (const note of notes) {
    const bucket = byOnset.get(note.startTicks) ?? [];
    bucket.push(note);
    byOnset.set(note.startTicks, bucket);
  }

  const onsets = [...byOnset.keys()].sort((left, right) => left - right);
  return onsets.flatMap((onset, index) => {
    const chord = byOnset.get(onset) ?? [];
    const next = onsets[index + 1] ?? Number.POSITIVE_INFINITY;
    const sounds = Math.max(...chord.map((note) => note.endTicks));
    const endTicks = Math.min(next, sounds);
    if (endTicks <= onset) {
      return [];
    }
    return [
      {
        startTicks: onset,
        endTicks,
        midis: [...new Set(chord.map((note) => note.midi))].sort((left, right) => left - right),
      },
    ];
  });
}

/**
 * The values one span of a beat is written as.
 *
 * A triplet beat is filled from the triplet vocabulary and a plain one from
 * the ordinary values. They may not be mixed inside a beat: a tuplet group is
 * *inferred* from the run of tuplet values that adds up to a plain one, so a
 * lone triplet eighth beside a sixteenth is a group that never closes and a
 * bar the engraver cannot draw.
 */
function valuesFor(lengthTicks: number, grid: BeatGrid, ticksPerBeat: number): Duration[] {
  if (grid !== 'triplet') {
    return splitIntoRests(lengthTicks);
  }
  const values: Duration[] = [];
  let remaining = lengthTicks;
  const vocabulary = tripletVocabulary(ticksPerBeat);

  while (remaining > 0) {
    const found = vocabulary.find((value) => value.ticks <= remaining);
    if (found === undefined) {
      throw new DomainError(`${remaining} divisions do not fit this beat's triplet.`);
    }
    values.push(found);
    remaining -= found.ticks;
  }
  return values;
}

/**
 * Cuts a span at bar lines, at beats written as triplets, and at values that
 * can actually be written.
 *
 * Every cut makes a tie: a note held over a bar line is one press, and so is
 * a five-eighth span that no single notehead can say. Triplet beats are cut
 * at their edges as well, so that whatever fills one adds up to the whole
 * beat and the group the engraver infers is complete.
 */
function tileSpan(
  startTicks: number,
  endTicks: number,
  layout: Layout,
  emit: (measureIndex: number, value: Duration, last: boolean) => void,
): void {
  let at = startTicks;
  while (at < endTicks) {
    const measureIndex = Math.floor(at / layout.ticksPerMeasure);
    const beat = Math.floor(at / layout.ticksPerBeat);
    const grid = layout.grids[beat] ?? 'plain';
    const measureEnd = (measureIndex + 1) * layout.ticksPerMeasure;
    let until = Math.min(endTicks, measureEnd);
    if (grid === 'triplet') {
      until = Math.min(until, (beat + 1) * layout.ticksPerBeat);
    } else {
      // A plain span runs on past its own beat - cutting a half note into
      // four tied quarters would be correct and unreadable - but it stops
      // dead at the first beat written as triplets. Running into one was the
      // bug: a span of four triplet eighths that began on a plain beat was
      // handed to the plain values, which get within forty divisions of it
      // and can go no further.
      for (let next = beat + 1; next * layout.ticksPerBeat < until; next += 1) {
        if ((layout.grids[next] ?? 'plain') === 'triplet') {
          until = next * layout.ticksPerBeat;
          break;
        }
      }
    }
    for (const value of valuesFor(until - at, grid, layout.ticksPerBeat)) {
      at += value.ticks;
      emit(measureIndex, value, at >= endTicks);
    }
  }
}

interface Layout {
  readonly ticksPerMeasure: number;
  readonly ticksPerBeat: number;
  readonly grids: readonly BeatGrid[];
}

function buildStaff(
  segments: readonly Segment[],
  bars: number,
  layout: Layout,
  staffNumber: number,
  voice: number,
  preferFlats: boolean,
): StaffPart {
  const placed: { measureIndex: number; entry: MusicalEntry }[] = [];
  const silence = (from: number, to: number): void => {
    tileSpan(from, to, layout, (measureIndex, value) => {
      placed.push({ measureIndex, entry: restEntry(value) });
    });
  };

  let at = 0;
  for (const segment of segments) {
    if (segment.startTicks > at) {
      silence(at, segment.startTicks);
    }
    const pitches = segment.midis.map((midi) => Pitch.fromMidi(midi, preferFlats));
    tileSpan(segment.startTicks, segment.endTicks, layout, (measureIndex, value, last) => {
      placed.push({
        measureIndex,
        entry: noteEntry(pitches, value, last ? [] : segment.midis),
      });
    });
    at = segment.endTicks;
  }
  silence(at, bars * layout.ticksPerMeasure);

  const measures = Array.from({ length: bars }, (_, index) =>
    measureOf(placed.filter((each) => each.measureIndex === index).map((each) => each.entry)),
  );

  return {
    staffNumber,
    voice,
    clef: staffNumber === RIGHT_HAND ? 'treble' : 'bass',
    clefChanges: [],
    measures,
  };
}

/**
 * Turns a performance into a page.
 *
 * The uncertain half of reading a MIDI file, and deliberately separate from
 * the certain half. `readMidiFile` reports what the bytes say; this decides
 * what they *mean* as notation - which is a judgement, because a MIDI file
 * records key presses and a score records lines of music, and the second
 * cannot be recovered from the first. What is decided is reported back rather
 * than hidden, so a reader can see whether the page they got is the page they
 * expected.
 */
export function midiToExercise(
  document: MidiFileDocument,
  title: string,
  options: MidiImportOptions = {},
): ImportedScore {
  const splitAtMidi = options.splitAtMidi ?? DEFAULT_SPLIT_MIDI;
  const warnings: ImportWarning[] = [];
  const scale = DIVISIONS_PER_QUARTER / document.division;
  const signature = new TimeSignature(document.beats, document.beatType);
  const ticksPerBeat = signature.ticksPerBeat;
  const triplet = tripletGridFor(ticksPerBeat);

  // Which grid each beat was played on has to be settled before anything is
  // pulled onto one: three notes in a beat are a triplet and four are
  // sixteenths, and once a note has been moved the difference is gone.
  const rough = document.notes.flatMap((note) => [note.startTicks * scale, note.endTicks * scale]);
  const roughLast = rough.length === 0 ? 0 : Math.max(...rough);
  const grids = gridsByBeat(rough, ticksPerBeat, Math.ceil(roughLast / ticksPerBeat) + 1);
  const pull = (ticks: number): number =>
    snapToBeat(ticks, grids, ticksPerBeat, triplet ?? PLAIN_GRID);

  let moved = 0;
  let dropped = 0;
  const notes: MidiFileNote[] = [];
  for (const note of document.notes) {
    const startTicks = pull(note.startTicks * scale);
    const endTicks = pull(note.endTicks * scale);
    if (endTicks <= startTicks) {
      dropped += 1;
      continue;
    }
    if (Math.abs(note.startTicks * scale - startTicks) > 1) {
      moved += 1;
    }
    notes.push({ ...note, startTicks, endTicks });
  }

  if (notes.length === 0) {
    throw new DomainError('Every note in this file was too short to write down.');
  }

  const timeSignature = signature;
  const ticksPerMeasure = timeSignature.ticksPerMeasure;
  const lastTick = Math.max(...notes.map((note) => note.endTicks));
  const bars = Math.max(1, Math.ceil(lastTick / ticksPerMeasure));
  const preferFlats = document.fifths < 0;

  const { byNote, fromPitch } = assignStaves(notes, splitAtMidi);
  const right = notes.filter((note) => byNote.get(note) === RIGHT_HAND);
  const left = notes.filter((note) => byNote.get(note) === LEFT_HAND);

  if (moved > 0) {
    warnings.push({
      kind: 'quantised',
      detail: `${moved} note${moved === 1 ? ' was' : 's were'} moved onto the nearest written position.`,
    });
  }
  if (dropped > 0) {
    warnings.push({
      kind: 'dropped-notes',
      detail: `${dropped} note${dropped === 1 ? ' was' : 's were'} too short to write down.`,
    });
  }
  if (fromPitch) {
    warnings.push({
      kind: 'split-by-pitch',
      detail: 'The file keeps both hands together, so they were divided at middle C.',
    });
  }
  warnings.push({
    kind: 'voices-merged',
    detail:
      'A MIDI file records key presses, not lines of music, so each staff is written as one voice: a note held under a moving line ends where the line moves.',
  });

  const layout: Layout = { ticksPerMeasure, ticksPerBeat, grids };
  const staves = [
    buildStaff(segmentsFor(right), bars, layout, RIGHT_HAND, 1, preferFlats),
    buildStaff(segmentsFor(left), bars, layout, LEFT_HAND, 2, preferFlats),
  ];

  const tripletBeats = grids.filter((each) => each === 'triplet').length;
  if (tripletBeats > 0) {
    warnings.push({
      kind: 'quantised',
      detail: `${tripletBeats} beat${tripletBeats === 1 ? ' was' : 's were'} written as triplets.`,
    });
  }

  const pedalMarks: PedalMark[] = document.pedal.map((mark) => {
    const ticks = pull(mark.atTicks * scale);
    return {
      measureIndex: Math.min(bars - 1, Math.floor(ticks / ticksPerMeasure)),
      offsetTicks: ticks % ticksPerMeasure,
      // A bracket, because a recording says exactly how long the pedal was
      // held and the bracket is the notation that says exactly that.
      line: true,
      type: mark.down ? ('start' as const) : ('stop' as const),
    };
  });

  const exercise: Exercise = {
    id: `midi-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    title,
    key: KeySignature.major(document.fifths),
    keyChanges: [],
    timeChanges: [],
    tempoChanges: [],
    pedalMarks,
    timeSignature,
    tempoBpm: document.tempoBpm,
    firstBarNumber: 1,
    staves,
    metadata: { generatorId: 'import.midi', seed: 0 },
  };

  validateExercise(exercise);
  return { exercise, warnings };
}
