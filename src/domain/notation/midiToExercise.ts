import { DIVISIONS_PER_QUARTER } from '../model/Duration.js';
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
  /**
   * Finest grid onsets are pulled onto, in divisions.
   *
   * A twenty-fourth of a quarter, which divides both the ordinary values and
   * the triplet ones - a grid of thirty-seconds alone would quietly destroy
   * every triplet in the piece by rounding it to something notatable and
   * wrong.
   */
  readonly gridTicks?: number;
}

const DEFAULT_SPLIT_MIDI = 60;
const DEFAULT_GRID_TICKS = 20;
const RIGHT_HAND = 1;
const LEFT_HAND = 2;

/** A chord: everything struck at one instant on one staff, and how long for. */
interface Segment {
  readonly startTicks: number;
  readonly endTicks: number;
  readonly midis: readonly number[];
}

function quantise(ticks: number, grid: number): number {
  return Math.round(ticks / grid) * grid;
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
 * Cuts a span at bar lines and at values that can actually be written.
 *
 * Both cuts make ties: a note held over a bar line is one press, and so is a
 * five-eighth span that no single notehead can say. What comes back is
 * already grouped by measure, because where the bar lines fall is the whole
 * reason some of the cuts exist.
 */
function tileSegment(
  segment: Segment,
  ticksPerMeasure: number,
  preferFlats: boolean,
): { readonly measureIndex: number; readonly entry: MusicalEntry }[] {
  const pitches = segment.midis.map((midi) => Pitch.fromMidi(midi, preferFlats));
  const out: { measureIndex: number; entry: MusicalEntry }[] = [];
  let at = segment.startTicks;

  while (at < segment.endTicks) {
    const measureIndex = Math.floor(at / ticksPerMeasure);
    const measureEnd = (measureIndex + 1) * ticksPerMeasure;
    const until = Math.min(segment.endTicks, measureEnd);
    for (const value of splitIntoRests(until - at)) {
      const last = at + value.ticks >= segment.endTicks;
      out.push({
        measureIndex,
        entry: noteEntry(pitches, value, last ? [] : segment.midis),
      });
      at += value.ticks;
    }
  }
  return out;
}

/** Rests filling a silence, cut at bar lines the same way. */
function tileSilence(
  fromTicks: number,
  toTicks: number,
  ticksPerMeasure: number,
): { readonly measureIndex: number; readonly entry: MusicalEntry }[] {
  const out: { measureIndex: number; entry: MusicalEntry }[] = [];
  let at = fromTicks;
  while (at < toTicks) {
    const measureIndex = Math.floor(at / ticksPerMeasure);
    const measureEnd = (measureIndex + 1) * ticksPerMeasure;
    const until = Math.min(toTicks, measureEnd);
    for (const value of splitIntoRests(until - at)) {
      out.push({ measureIndex, entry: restEntry(value) });
      at += value.ticks;
    }
  }
  return out;
}

function buildStaff(
  segments: readonly Segment[],
  bars: number,
  ticksPerMeasure: number,
  staffNumber: number,
  voice: number,
  preferFlats: boolean,
): StaffPart {
  const placed: { measureIndex: number; entry: MusicalEntry }[] = [];
  let at = 0;
  for (const segment of segments) {
    if (segment.startTicks > at) {
      placed.push(...tileSilence(at, segment.startTicks, ticksPerMeasure));
    }
    placed.push(...tileSegment(segment, ticksPerMeasure, preferFlats));
    at = segment.endTicks;
  }
  placed.push(...tileSilence(at, bars * ticksPerMeasure, ticksPerMeasure));

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
  const grid = options.gridTicks ?? DEFAULT_GRID_TICKS;
  const splitAtMidi = options.splitAtMidi ?? DEFAULT_SPLIT_MIDI;
  const warnings: ImportWarning[] = [];
  const scale = DIVISIONS_PER_QUARTER / document.division;

  let moved = 0;
  let dropped = 0;
  const notes: MidiFileNote[] = [];
  for (const note of document.notes) {
    const startTicks = quantise(note.startTicks * scale, grid);
    const endTicks = quantise(note.endTicks * scale, grid);
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

  const timeSignature = new TimeSignature(document.beats, document.beatType);
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

  const staves = [
    buildStaff(segmentsFor(right), bars, ticksPerMeasure, RIGHT_HAND, 1, preferFlats),
    buildStaff(segmentsFor(left), bars, ticksPerMeasure, LEFT_HAND, 2, preferFlats),
  ];

  const pedalMarks: PedalMark[] = document.pedal.map((mark) => {
    const ticks = quantise(mark.atTicks * scale, grid);
    return {
      measureIndex: Math.min(bars - 1, Math.floor(ticks / ticksPerMeasure)),
      offsetTicks: ticks % ticksPerMeasure,
      type: mark.down ? ('start' as const) : ('stop' as const),
    };
  });

  const exercise: Exercise = {
    id: `midi-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    title,
    key: KeySignature.major(document.fifths),
    keyChanges: [],
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
