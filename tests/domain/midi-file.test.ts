import { describe, expect, it } from 'vitest';
import {
  barsAreHeardIn,
  damperIsDown,
  theClickOfTheTake,
  writeMidiFile,
  type HeardBeat,
  type MidiFileEvent,
} from '../../src/domain/midi/MidiFile.js';
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

/** One thing written in the track: the tick it is at, and its bytes. */
interface Written {
  readonly tick: number;
  readonly bytes: readonly number[];
}

/** Reads the track back event by event; the writer never uses running status. */
function written(bytes: Uint8Array): Written[] {
  const track = trackBytes(bytes);
  const found: Written[] = [];
  let at = 0;
  let tick = 0;
  while (at < track.length) {
    let delta = 0;
    for (;;) {
      const byte = track[at] ?? 0;
      at += 1;
      delta = (delta << 7) | (byte & 0x7f);
      if (byte < 0x80) {
        break;
      }
    }
    tick += delta;
    const length = track[at] === 0xff ? 3 + (track[at + 2] ?? 0) : 3;
    found.push({ tick, bytes: track.slice(at, at + length) });
    at += length;
  }
  return found;
}

function struckAt(bytes: Uint8Array): number[] {
  return written(bytes)
    .filter((each) => each.bytes[0] === 0x90)
    .map((each) => each.tick);
}

function temposIn(bytes: Uint8Array): { readonly tick: number; readonly microseconds: number }[] {
  return written(bytes)
    .filter((each) => each.bytes[0] === 0xff && each.bytes[1] === 0x51)
    .map(({ tick, bytes: [, , , high = 0, middle = 0, low = 0] }) => ({
      tick,
      microseconds: (high << 16) | (middle << 8) | low,
    }));
}

function barsIn(bytes: Uint8Array): { readonly tick: number; readonly beats: number }[] {
  return written(bytes)
    .filter((each) => each.bytes[0] === 0xff && each.bytes[1] === 0x58)
    .map((each) => ({ tick: each.tick, beats: each.bytes[3] ?? 0 }));
}

/** `count` beats of a click, `gapMs` apart from `fromMs`, the first at `firstBeat` of its bar. */
function click(fromMs: number, gapMs: number, count: number, beatsInBar = 4, firstBeat = 0): HeardBeat[] {
  return Array.from({ length: count }, (_, at) => ({
    atMs: fromMs + at * gapMs,
    beat: (firstBeat + at) % beatsInBar,
    beatsInBar,
  }));
}

/** A short note struck at each moment. */
function struck(...moments: number[]): MidiFileEvent[] {
  return moments.flatMap((atMs) => [
    { kind: 'noteOn' as const, atMs, midi: 60, velocity: 0.8 },
    { kind: 'noteOff' as const, atMs: atMs + 1, midi: 60 },
  ]);
}

/** A crotchet's ticks in the files this writes. */
const BEAT = 480;

describe('writing a take in the bars of the click it was played to', () => {
  it('places every moment as far between two beats as it fell, through a change of pace', () => {
    // Four beats at 100 bpm, then four at 120: across the whole of each beat.
    const beats = [...click(0, 600, 4), ...click(2_400, 500, 5)];
    const moments: number[] = [];
    const expected: number[] = [];
    beats.slice(0, -1).forEach((beat, at) => {
      const gap = (beats[at + 1]?.atMs ?? 0) - beat.atMs;
      for (let part = 0; part < 24; part += 1) {
        moments.push(beat.atMs + (gap * part) / 24);
        expected.push(Math.round(BEAT * (at + part / 24)));
      }
    });

    expect(struckAt(writeMidiFile(struck(...moments), { beats }))).toEqual(expected);
  });

  it('opens on the bar the first note falls in, a phrase begun partway in on rests', () => {
    // A bar of the click before the playing began, and then two beats of the
    // bar it began in: that bar is the first.
    const bytes = writeMidiFile(struck(1_200, 1_800), { beats: click(-2_400, 600, 10) });

    expect(struckAt(bytes)).toEqual([2 * BEAT, 3 * BEAT]);
  });

  it('counts a first note up to half a beat ahead of a bar as one in that bar', () => {
    // The downbeat of the second bar at 2400 ms, beats 600 ms apart.
    for (let early = 0; early <= 600; early += 25) {
      const bytes = writeMidiFile(struck(2_400 - early), { beats: click(0, 600, 8) });
      const expected = early <= 300 ? 0 : Math.round(BEAT * (3 + (600 - early) / 600));

      expect(struckAt(bytes), `${early} ms early`).toEqual([expected]);
    }
  });

  it('carries a click set going after the playing began back at its pace and in its bars', () => {
    // Bars of three, the click starting on the second beat of one, a second
    // after the first note: two beats back is a downbeat, at 0 ms, and three
    // before that the one the playing began in.
    const bytes = writeMidiFile(struck(0, 1_000), { beats: click(1_000, 500, 6, 3, 1) });

    expect(struckAt(bytes)).toEqual([2 * BEAT, 4 * BEAT]);
    expect(barsIn(bytes)).toEqual([{ tick: 0, beats: 3 }]);
  });

  it('carries the click on at its last pace past its last beat', () => {
    const bytes = writeMidiFile(struck(0, 2_700, 3_000), { beats: click(0, 600, 4) });

    expect(struckAt(bytes)).toEqual([0, 4.5 * BEAT, 5 * BEAT]);
  });

  it('writes the tempo of a beat and the bar at a downbeat only where either changes', () => {
    // Two bars of four at 100 bpm, then bars of three at 120.
    const beats = [...click(0, 600, 8), ...click(4_800, 500, 6, 3)];
    const bytes = writeMidiFile(struck(0, 7_300), { beats });

    expect(temposIn(bytes)).toEqual([
      { tick: 0, microseconds: 600_000 },
      { tick: 8 * BEAT, microseconds: 500_000 },
    ]);
    expect(barsIn(bytes)).toEqual([
      { tick: 0, beats: 4 },
      { tick: 8 * BEAT, beats: 3 },
    ]);
    expect(struckAt(bytes)).toEqual([0, 13 * BEAT]);
  });

  it('marks a new bar on the first beat of one, wherever the click began counting it', () => {
    // Bars of four, and then of three from the third beat of one: the bar
    // it was third in is still four long, and the next is three.
    const beats = [...click(0, 600, 6), ...click(3_600, 600, 4, 3, 2)];
    const bytes = writeMidiFile(struck(0, 5_400), { beats });

    expect(barsIn(bytes)).toEqual([
      { tick: 0, beats: 4 },
      { tick: 7 * BEAT, beats: 3 },
    ]);
  });

  it('writes what it always wrote without two beats apart to read a pace from', () => {
    const events = struck(0, 450, 1_300);
    const plain = writeMidiFile(events, { trackName: 'Idea' });

    for (const beats of [[], click(0, 600, 1), click(0, 0, 2)]) {
      expect(writeMidiFile(events, { trackName: 'Idea', beats })).toEqual(plain);
    }
  });
});

describe('the beats a take is written in', () => {
  it('carries a click stopped before the playing did on to its last event, in its last bar', () => {
    const beats = theClickOfTheTake(struck(0, 2_000), click(0, 600, 4, 3));

    expect(beats?.map((beat) => [beat.atMs, beat.beat])).toEqual([
      [0, 0],
      [600, 1],
      [1_200, 2],
      [1_800, 0],
      [2_400, 1],
    ]);
  });

  it('carries on nothing at a pace of nothing', () => {
    const beats = [...click(0, 600, 2), { atMs: 600, beat: 2, beatsInBar: 4 }];

    expect(theClickOfTheTake(struck(0, 3_000), beats)).toHaveLength(3);
  });

  it('says nothing for a click that says nothing', () => {
    expect(theClickOfTheTake(struck(0), click(0, 600, 1))).toBeNull();
  });
});

describe('whether a click says where its bars are', () => {
  it('needs two beats heard apart', () => {
    expect(barsAreHeardIn([])).toBe(false);
    expect(barsAreHeardIn(click(0, 600, 1))).toBe(false);
    expect(barsAreHeardIn(click(0, 0, 2))).toBe(false);
    expect(barsAreHeardIn(click(0, 600, 2))).toBe(true);
  });
});
