import { describe, expect, it } from 'vitest';
import { writeMidiFile, type MidiFileEvent } from '../../src/domain/midi/MidiFile.js';
import { readMidiFile } from '../../src/domain/midi/readMidiFile.js';
import { midiToExercise } from '../../src/domain/notation/midiToExercise.js';
import { measureCount, validateExercise } from '../../src/domain/model/Exercise.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { DomainError } from '../../src/shared/errors.js';

/** The writer's own tempo is 120, so a quarter note is half a second. */
const QUARTER_MS = 500;

function note(midi: number, atMs: number, lengthMs: number): MidiFileEvent[] {
  return [
    { kind: 'noteOn', atMs, midi, velocity: 0.8 },
    { kind: 'noteOff', atMs: atMs + lengthMs, midi },
  ];
}

/** Writes a file with our own writer, so the test owns both ends of the trip. */
function fileOf(events: readonly MidiFileEvent[]): Uint8Array {
  return writeMidiFile(
    [...events].sort((left, right) => left.atMs - right.atMs),
    { trackName: 'Something Borrowed' },
  );
}

/**
 * A one-track file holding exactly the bytes given.
 *
 * The writer in this project is deliberately conservative - it always states
 * a command byte and never sends a note-on at no velocity - so the shapes
 * real files use most cannot be produced from inside. They are written out
 * here instead, which is also the only way to be sure the reader is being
 * tested rather than the writer.
 */
function handWritten(trackBytes: readonly number[]): Uint8Array {
  const track = [...trackBytes, 0x00, 0xff, 0x2f, 0x00];
  const length = track.length;
  return Uint8Array.from([
    0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06,
    0x00, 0x00, 0x00, 0x01,
    // 480 ticks to the quarter, the same division our own writer uses.
    0x01, 0xe0,
    0x4d, 0x54, 0x72, 0x6b,
    (length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff,
    ...track,
  ]);
}

/** A two-track file, which is how a writer says "these are the two hands". */
function twoTracks(first: readonly number[], second: readonly number[]): Uint8Array {
  const chunk = (bytes: readonly number[]): number[] => {
    const track = [...bytes, 0x00, 0xff, 0x2f, 0x00];
    const length = track.length;
    return [
      0x4d, 0x54, 0x72, 0x6b,
      (length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff,
      ...track,
    ];
  };
  return Uint8Array.from([
    0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06,
    0x00, 0x01, 0x00, 0x02,
    0x01, 0xe0,
    ...chunk(first),
    ...chunk(second),
  ]);
}

describe('reading a MIDI file', () => {
  it('recovers the notes, their order and their lengths', () => {
    const document = readMidiFile(
      fileOf([
        ...note(60, 0, QUARTER_MS),
        ...note(62, QUARTER_MS, QUARTER_MS),
        ...note(64, 2 * QUARTER_MS, 2 * QUARTER_MS),
      ]),
    );

    expect(document.notes.map((each) => each.midi)).toEqual([60, 62, 64]);
    const [first, , third] = document.notes;
    expect(first?.startTicks).toBe(0);
    expect((third?.endTicks ?? 0) - (third?.startTicks ?? 0)).toBe(2 * document.division);
  });

  it('reads a chord as notes that share an instant', () => {
    const document = readMidiFile(
      fileOf([...note(60, 0, QUARTER_MS), ...note(64, 0, QUARTER_MS), ...note(67, 0, QUARTER_MS)]),
    );

    expect(document.notes.map((each) => each.startTicks)).toEqual([0, 0, 0]);
    expect(document.notes.map((each) => each.midi)).toEqual([60, 64, 67]);
  });

  it('takes a note-on at no velocity for a note-off, as most writers mean it', () => {
    // Not a nicety: a file that says it this way and is read literally has a
    // note that never stops, and every note after it lands inside a chord.
    // Built by hand because our own writer will not say it that way - it
    // clamps velocity to one, so the case cannot be reached from inside.
    const document = readMidiFile(
      handWritten([0x00, 0x90, 60, 0x40, 0x81, 0x70, 0x90, 60, 0x00]),
    );

    expect(document.notes).toHaveLength(1);
    expect(document.notes[0]?.endTicks).toBe(240);
  });

  it('follows running status, which is how a real file saves its bytes', () => {
    // The command byte is left out when it repeats. A reader that assumed one
    // per event would read the data as commands and produce nonsense rather
    // than an error - which is worse than failing.
    const document = readMidiFile(
      handWritten([
        0x00, 0x90, 60, 0x40,
        0x00, 62, 0x40,
        0x81, 0x70, 60, 0x00,
        0x00, 62, 0x00,
      ]),
    );

    expect(document.notes.map((note) => note.midi)).toEqual([60, 62]);
    expect(document.notes.every((note) => note.endTicks === 240)).toBe(true);
  });

  it('keeps the damper pedal', () => {
    const document = readMidiFile(
      fileOf([
        { kind: 'sustain', atMs: 0, value: 1 },
        ...note(60, 0, QUARTER_MS),
        { kind: 'sustain', atMs: QUARTER_MS, value: 0 },
      ]),
    );

    expect(document.pedal.map((mark) => mark.down)).toEqual([true, false]);
  });

  it('says so plainly when the file is not one', () => {
    expect(() => readMidiFile(new Uint8Array([1, 2, 3, 4]))).toThrow(DomainError);
    expect(() => readMidiFile(new TextEncoder().encode('<score-partwise/>'))).toThrow(
      /not a MIDI file/,
    );
  });

  it('refuses a file that measures time in frames rather than beats', () => {
    // SMPTE division counts wall-clock frames, so there is no musical grid in
    // the file at all - nothing to quantise against and nothing to bar off.
    const bytes = fileOf(note(60, 0, QUARTER_MS));
    // The division is the last two bytes of the header chunk.
    bytes[12] = 0xe2;
    bytes[13] = 0x28;

    expect(() => readMidiFile(bytes)).toThrow(/frames rather than in beats/);
  });
});

describe('turning a MIDI file into a page', () => {
  function pageOf(events: readonly MidiFileEvent[]) {
    return midiToExercise(readMidiFile(fileOf(events)), 'Something Borrowed');
  }

  it('produces a score that passes every rule a written one must', () => {
    const { exercise } = pageOf([
      ...note(60, 0, QUARTER_MS),
      ...note(62, QUARTER_MS, QUARTER_MS),
      ...note(64, 2 * QUARTER_MS, QUARTER_MS),
      ...note(65, 3 * QUARTER_MS, QUARTER_MS),
    ]);

    expect(() => validateExercise(exercise)).not.toThrow();
    expect(measureCount(exercise)).toBe(1);
    expect(exercise.timeSignature.toString()).toBe('4/4');
  });

  it('asks for every note that was played, in the order it was played', () => {
    const { exercise } = pageOf([
      ...note(72, 0, QUARTER_MS),
      ...note(74, QUARTER_MS, QUARTER_MS),
      ...note(48, 0, 2 * QUARTER_MS),
      ...note(76, 2 * QUARTER_MS, 2 * QUARTER_MS),
    ]);

    expect(buildTimeline(exercise).steps.flatMap((step) => step.expectedMidi)).toEqual([
      48, 72, 74, 76,
    ]);
  });

  it('divides the hands at middle C when the file keeps them together', () => {
    const { exercise, warnings } = pageOf([
      ...note(72, 0, QUARTER_MS),
      ...note(48, 0, QUARTER_MS),
    ]);

    expect(warnings.map((warning) => warning.kind)).toContain('split-by-pitch');
    const right = exercise.staves.find((staff) => staff.staffNumber === 1);
    const left = exercise.staves.find((staff) => staff.staffNumber === 2);
    expect(right?.clef).toBe('treble');
    expect(left?.clef).toBe('bass');
  });

  it('ties a note held across a bar line rather than asking for it twice', () => {
    // A tie is one press. Demanding the far side of it would have the reader
    // striking a key they are already holding.
    const { exercise } = pageOf(note(60, 3 * QUARTER_MS, 2 * QUARTER_MS));

    expect(measureCount(exercise)).toBe(2);
    expect(() => validateExercise(exercise)).not.toThrow();
    const demanded = buildTimeline(exercise).steps.flatMap((step) => step.expectedMidi);
    expect(demanded.filter((midi) => midi === 60)).toHaveLength(1);
  });

  it('fills the silence a performance leaves with rests', () => {
    const { exercise } = pageOf(note(60, 2 * QUARTER_MS, QUARTER_MS));

    expect(() => validateExercise(exercise)).not.toThrow();
    // One bar, filled: two beats of rest, the note, and a beat of rest after.
    expect(measureCount(exercise)).toBe(1);
  });

  it('says what it had to decide rather than deciding it quietly', () => {
    // A MIDI file records key presses and a score records lines of music, and
    // the second cannot be recovered from the first. The reader should be
    // able to see which parts of their page were a judgement.
    const { warnings } = pageOf(note(60, 0, QUARTER_MS));

    expect(warnings.map((warning) => warning.kind)).toContain('voices-merged');
  });
});

describe('a file that separates the hands itself', () => {
  it('reads the tracks rather than remaking the decision from pitch', () => {
    // A left hand that climbs above middle C is ordinary, and splitting there
    // would throw it onto the other stave mid-phrase. Whoever wrote the file
    // has already answered this better than any rule could.
    const right = [
      0x00, 0x90, 72, 0x40, 0x83, 0x60, 0x80, 72, 0x40,
      0x00, 0x90, 55, 0x40, 0x83, 0x60, 0x80, 55, 0x40,
    ];
    const left = [
      0x00, 0x90, 48, 0x40, 0x83, 0x60, 0x80, 48, 0x40,
      0x00, 0x90, 64, 0x40, 0x83, 0x60, 0x80, 64, 0x40,
    ];
    const { exercise, warnings } = midiToExercise(
      readMidiFile(twoTracks(right, left)),
      'Two hands',
    );

    expect(warnings.map((warning) => warning.kind)).not.toContain('split-by-pitch');
    const treble = exercise.staves.find((staff) => staff.staffNumber === 1);
    const bass = exercise.staves.find((staff) => staff.staffNumber === 2);
    const pitchesIn = (staff: typeof treble): number[] =>
      (staff?.measures ?? []).flatMap((measure) =>
        measure.entries.flatMap((entry) =>
          entry.kind === 'note' ? entry.pitches.map((pitch) => pitch.midi) : [],
        ),
      );

    // G3 stays in the right hand and E4 in the left, because that is where
    // the file put them.
    expect(pitchesIn(treble)).toEqual([72, 55]);
    expect(pitchesIn(bass)).toEqual([48, 64]);
  });
});
