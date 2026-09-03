import { describe, expect, it } from 'vitest';
import { damperIsDown, writeMidiFile, type MidiFileEvent } from '../../src/domain/midi/MidiFile.js';
import { DomainError } from '../../src/shared/errors.js';

function ascii(bytes: Uint8Array, from: number, length: number): string {
  return [...bytes.slice(from, from + length)].map((byte) => String.fromCharCode(byte)).join('');
}

/** Splits the track's event bytes off, past the two chunk headers. */
function trackBytes(bytes: Uint8Array): number[] {
  return [...bytes.slice(22)];
}

const ONE_NOTE: readonly MidiFileEvent[] = [
  { kind: 'noteOn', atMs: 0, midi: 60, velocity: 1 },
  { kind: 'noteOff', atMs: 500, midi: 60 },
];

describe('writing a Standard MIDI File', () => {
  it('declares itself as one', () => {
    const bytes = writeMidiFile(ONE_NOTE);

    expect(ascii(bytes, 0, 4)).toBe('MThd');
    // Format 0, one track: a capture of one keyboard is one stream, and every
    // program reads format 0.
    // 480 ticks to the quarter, which is what a sequencer expects to see -
    // and deliberately not the notation's divisions, which a capture has no
    // use for.
    expect([...bytes.slice(8, 14)]).toEqual([0, 0, 0, 1, (480 >> 8) & 0xff, 480 & 0xff]);
    expect(ascii(bytes, 14, 4)).toBe('MTrk');
  });

  it('states the length of the track it wrote', () => {
    const bytes = writeMidiFile(ONE_NOTE);
    const at = (index: number): number => bytes[index] ?? 0;
    const declared = (at(18) << 24) | (at(19) << 16) | (at(20) << 8) | at(21);

    // A length that disagrees with the bytes is a file nothing will open.
    expect(declared).toBe(bytes.length - 22);
  });

  it('places the notes where they were actually played', () => {
    // 120 bpm and 480 ticks to the quarter: a quarter lasts 500 ms, so a note
    // released half a second after it began is one quarter long.
    const track = trackBytes(writeMidiFile(ONE_NOTE));
    const noteOn = track.indexOf(0x90);

    expect(track.slice(noteOn, noteOn + 3)).toEqual([0x90, 60, 127]);
    // Delta before the note-off, as a variable-length quantity: 480 = 0x83 0x60.
    expect(track.slice(noteOn + 3, noteOn + 8)).toEqual([0x83, 0x60, 0x80, 60, 0x40]);
  });

  it('ends the track, so a reader knows where to stop', () => {
    const track = trackBytes(writeMidiFile(ONE_NOTE));
    expect(track.slice(-4)).toEqual([0x00, 0xff, 0x2f, 0x00]);
  });

  it('writes the tempo it placed the notes against', () => {
    const track = trackBytes(writeMidiFile(ONE_NOTE, { tempoBpm: 60 }));

    // 60 bpm is a million microseconds to the quarter: 0x0F4240.
    expect(track.slice(0, 7)).toEqual([0x00, 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40]);
  });

  it('scales the notes with the tempo it declares', () => {
    const track = trackBytes(writeMidiFile(ONE_NOTE, { tempoBpm: 60 }));
    const noteOn = track.indexOf(0x90);

    // At 60 bpm a quarter lasts a second, so the same half-second note is an
    // eighth: 240 ticks, or 0x81 0x70.
    expect(track.slice(noteOn + 3, noteOn + 5)).toEqual([0x81, 0x70]);
  });

  it('releases a key before it is struck again at the same instant', () => {
    // A repeated note whose release and press land on one millisecond: written
    // the other way round, the release silences the note that just began.
    const track = trackBytes(
      writeMidiFile([
        { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.5 },
        { kind: 'noteOn', atMs: 100, midi: 60, velocity: 0.5 },
        { kind: 'noteOff', atMs: 100, midi: 60 },
      ]),
    );
    const first = track.indexOf(0x80);
    const second = track.indexOf(0x90, track.indexOf(0x90) + 1);

    expect(first).toBeLessThan(second);
  });

  it('never writes a note-on of zero velocity, which is a note-off', () => {
    const track = trackBytes(
      writeMidiFile([{ kind: 'noteOn', atMs: 0, midi: 60, velocity: 0 }]),
    );
    const noteOn = track.indexOf(0x90);

    expect(track[noteOn + 2]).toBe(1);
  });

  it('carries the sustain pedal as the controller it is', () => {
    const track = trackBytes(
      writeMidiFile([{ kind: 'sustain', atMs: 0, value: 1 }]),
    );
    const control = track.indexOf(0xb0);

    expect(track.slice(control, control + 3)).toEqual([0xb0, 0x40, 127]);
  });

  it('names the track when asked', () => {
    const bytes = writeMidiFile(ONE_NOTE, { trackName: 'take' });
    expect([...bytes].join(',')).toContain([0xff, 0x03, 4, 116, 97, 107, 101].join(','));
  });

  it('sorts events that arrive out of order', () => {
    const track = trackBytes(
      writeMidiFile([
        { kind: 'noteOff', atMs: 500, midi: 60 },
        { kind: 'noteOn', atMs: 0, midi: 60, velocity: 1 },
      ]),
    );
    expect(track.indexOf(0x90)).toBeLessThan(track.indexOf(0x80));
  });

  it('refuses a tempo that would place nothing anywhere', () => {
    expect(() => writeMidiFile(ONE_NOTE, { tempoBpm: 0 })).toThrow(DomainError);
  });

  it('writes a playable file for no events at all', () => {
    const bytes = writeMidiFile([]);
    expect(ascii(bytes, 0, 4)).toBe('MThd');
    expect(trackBytes(bytes).slice(-4)).toEqual([0x00, 0xff, 0x2f, 0x00]);
  });
});

describe('reading the damper pedal', () => {
  it('counts a pedal past halfway as holding the strings', () => {
    expect(damperIsDown(1)).toBe(true);
    expect(damperIsDown(0)).toBe(false);
    expect(damperIsDown(100 / 127)).toBe(true);
  });

  it('counts the halfway point itself as the felt touching', () => {
    // MIDI's convention is that 64 is already "on", which is right for a
    // switch because a switch only ever says 0 or 127. A pedal that reports
    // how far it has travelled says 64 on the way through in *both*
    // directions: a foot that comes up and goes straight back down - which
    // is how a pianist changes the pedal - is reported as `127, 64, 127`
    // with no zero anywhere in it. Read the convention's way, that is no
    // movement at all.
    expect(damperIsDown(64 / 127)).toBe(false);
    expect(damperIsDown(63 / 127)).toBe(false);
    expect(damperIsDown(65 / 127)).toBe(true);
  });
});
