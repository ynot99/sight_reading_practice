import { describe, expect, it } from 'vitest';
import {
  barsAreHeardIn,
  damperIsDown,
  takeWithTheDynamicFrom,
  takeWithTheKeyFrom,
  takeWithTheLoudnessWritten,
  theVelocityOfTheLevel,
  theBeatOfTheClickAt,
  theDynamicAt,
  theDynamicsOf,
  theDynamicsOfEachHand,
  theChangesOfTheClick,
  theKeyChangesOf,
  theKeyOfTheMusicAt,
  theClickInAnotherMetre,
  theClickOfTheTake,
  thePaceOfTheClick,
  thePlayingAtAnotherPace,
  thePlayingWithABarInserted,
  TRACK_OF_A_HAND,
  writeMidiFile,
  type HeardBeat,
  type MidiFileEvent,
  type NoteLoudness,
} from '../../src/domain/midi/MidiFile.js';
import { DomainError } from '../../src/shared/errors.js';
import { readMidiFile } from '../../src/domain/midi/readMidiFile.js';
import { DYNAMIC_VELOCITY } from '../../src/domain/model/Exercise.js';

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

  it('gives each beat the length of its own value, and writes the bar in it', () => {
    // Six quavers a bar, a quaver every 250 ms: a crotchet every half second.
    const quavers = click(0, 250, 12, 6).map((beat) => ({ ...beat, beatType: 8 }));
    const sixEight = writeMidiFile(struck(0, 250, 375, 1_500), { beats: quavers });

    expect(barsIn(sixEight)).toEqual([{ tick: 0, beats: 6 }]);
    expect(written(sixEight).find((each) => each.bytes[1] === 0x58)?.bytes.slice(3, 5)).toEqual([6, 3]);
    expect(temposIn(sixEight)).toEqual([{ tick: 0, microseconds: 500_000 }]);
    expect(struckAt(sixEight)).toEqual([0, BEAT / 2, (3 * BEAT) / 4, 3 * BEAT]);

    // Two minims a bar, a minim every second.
    const minims = click(0, 1_000, 4, 2).map((beat) => ({ ...beat, beatType: 2 }));
    const cut = writeMidiFile(struck(0, 1_500, 2_000), { beats: minims });
    expect(written(cut).find((each) => each.bytes[1] === 0x58)?.bytes.slice(3, 5)).toEqual([2, 1]);
    expect(temposIn(cut)).toEqual([{ tick: 0, microseconds: 500_000 }]);
    expect(struckAt(cut)).toEqual([0, 3 * BEAT, 4 * BEAT]);

    // Three crotchets a bar and then three quavers: the count the same, the bar not.
    const threes = [...click(0, 500, 3, 3), ...click(1_500, 250, 3, 3).map((beat) => ({ ...beat, beatType: 8 }))];
    const changed = writeMidiFile(struck(0, 1_750), { beats: threes });
    expect(
      written(changed)
        .filter((each) => each.bytes[1] === 0x58)
        .map((each) => [each.tick, each.bytes[3], each.bytes[4]]),
    ).toEqual([
      [0, 3, 2],
      [3 * BEAT, 3, 3],
    ]);

    // A click of quavers set going on the third of a bar after the playing
    // began is carried back in quavers.
    const late = click(500, 250, 4, 6, 2).map((beat) => ({ ...beat, beatType: 8 }));
    expect(struckAt(writeMidiFile(struck(0, 500), { beats: late }))).toEqual([0, BEAT]);
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

describe('a click counted in another metre', () => {
  const at = (beats: readonly HeardBeat[]): number[][] =>
    beats.map((beat) => [beat.atMs, beat.beat, beat.beatsInBar, beat.beatType ?? 4]);

  it('keeps every moment where it was and lays the bars afresh from the first', () => {
    // A bar of 4/4 at 120 and the start of the next, the playing to its third beat.
    const beats = click(0, 500, 6);

    expect(at(theClickInAnotherMetre(struck(0, 2_400), beats, 3, 4))).toEqual([
      [0, 0, 3, 4],
      [500, 1, 3, 4],
      [1_000, 2, 3, 4],
      [1_500, 0, 3, 4],
      [2_000, 1, 3, 4],
      [2_500, 2, 3, 4],
    ]);
    // A quaver beat is half a crotchet's time, a minim twice it; and every beat
    // the click gave is counted, past the playing too.
    expect(at(theClickInAnotherMetre(struck(0, 900), beats, 6, 8))).toEqual(
      Array.from({ length: 12 }, (_, beat) => [beat * 250, beat % 6, 6, 8]),
    );
    expect(at(theClickInAnotherMetre(struck(0, 2_400), beats, 2, 2))).toEqual([
      [0, 0, 2, 2],
      [1_000, 1, 2, 2],
      [2_000, 0, 2, 2],
    ]);
  });

  it('follows a change of pace, a beat that falls between two of the click as far between them as it is', () => {
    // Two crotchets at 100 bpm, then two at 120.
    const beats = click(0, 600, 4);
    const changed = [...beats.slice(0, 2), { atMs: 1_200, beat: 2, beatsInBar: 4 }, { atMs: 1_700, beat: 3, beatsInBar: 4 }];

    expect(at(theClickInAnotherMetre(struck(0, 1_800), changed, 6, 8)).map(([atMs]) => atMs)).toEqual([
      // Carried on past its last beat to the last of the playing, at its last pace.
      0, 300, 600, 900, 1_200, 1_450, 1_700, 1_950, 2_200, 2_450,
    ]);
  });

  it('comes back to the click it was counted from', () => {
    const beats = theClickOfTheTake(struck(0, 2_400), click(0, 500, 6));
    const there = theClickInAnotherMetre(struck(0, 2_400), click(0, 500, 6), 3, 4);

    expect(at(theClickInAnotherMetre(struck(0, 2_400), there, 4, 4))).toEqual(at(beats ?? []));
  });

  it('gives back a click that says nothing as it was', () => {
    const silent = click(0, 600, 1);

    expect(theClickInAnotherMetre(struck(0), silent, 3, 4)).toBe(silent);
  });
});

describe('the pace of a click', () => {
  it('is how many crotchets a minute it goes at where it begins, whatever its beats are worth', () => {
    expect(thePaceOfTheClick(struck(0, 900), click(0, 500, 4))).toBe(120);
    const quavers = click(0, 250, 6, 6).map((beat) => ({ ...beat, beatType: 8 }));
    expect(thePaceOfTheClick(struck(0, 900), quavers)).toBe(120);
    const minims = click(0, 1_500, 2, 2).map((beat) => ({ ...beat, beatType: 2 }));
    expect(thePaceOfTheClick(struck(0, 900), minims)).toBe(80);
    // From where it begins, though it changes after.
    expect(thePaceOfTheClick(struck(0, 900), [...click(0, 600, 2), { atMs: 1_100, beat: 2, beatsInBar: 4 }])).toBe(100);
  });

  it('is nothing for a click that says nothing', () => {
    expect(thePaceOfTheClick(struck(0), click(0, 600, 1))).toBeNull();
  });
});

describe('playing at another pace', () => {
  it('moves every moment across a beat to the same place in it at the new pace, from the first beat', () => {
    // A bar of 4/4 at 120 beginning at 300 ms, a moment every 25 ms across it.
    const beats = click(300, 500, 4);
    const moments = Array.from({ length: 80 }, (_, at) => 300 + at * 25);
    const paced = thePlayingAtAnotherPace(struck(...moments), beats, 60);
    const at = (kind: string): number[] =>
      paced.events.filter((event) => event.kind === kind).map((event) => Math.round(event.atMs * 1e6) / 1e6);

    expect(at('noteOn')).toEqual(moments.map((atMs) => 300 + (atMs - 300) * 2));
    // A note keeps its length in beats: here twice as long in time.
    expect(at('noteOff')).toEqual(moments.map((atMs) => 300 + (atMs + 1 - 300) * 2));
    // And the click as far as the playing goes, carried on past the beats given.
    expect(paced.beats.map((beat) => [beat.atMs, beat.beat])).toEqual([
      [300, 0],
      [1_300, 1],
      [2_300, 2],
      [3_300, 3],
      [4_300, 0],
    ]);
  });

  it('counts a beat as what it is worth: a quaver of 6/8 half a crotchet', () => {
    const quavers = click(0, 250, 6, 6).map((beat) => ({ ...beat, beatType: 8 }));
    const paced = thePlayingAtAnotherPace(struck(375, 1_000), quavers, 60);

    expect(paced.events.filter((event) => event.kind === 'noteOn').map((event) => event.atMs)).toEqual([750, 2_000]);
    expect(paced.beats.map((beat) => beat.atMs)).toEqual([0, 500, 1_000, 1_500, 2_000, 2_500]);
  });

  it('makes a click that changed pace go at one', () => {
    // Two crotchets at 100 bpm, then two at 120, played to their end.
    const beats = [...click(0, 600, 2), { atMs: 1_200, beat: 2, beatsInBar: 4 }, { atMs: 1_700, beat: 3, beatsInBar: 4 }];
    const paced = thePlayingAtAnotherPace(struck(300, 1_450, 2_000), beats, 120);

    expect(paced.beats.map((beat) => beat.atMs)).toEqual([0, 500, 1_000, 1_500, 2_000]);
    // Half way through the second beat, through the fourth, and a beat and two fifths after it.
    const struckAt = paced.events.filter((event) => event.kind === 'noteOn').map((event) => event.atMs);
    expect(struckAt.map((atMs) => Math.round(atMs * 1000) / 1000)).toEqual([250, 1_250, 1_800]);
  });

  it('keeps everything else a note or the pedal says', () => {
    const events: MidiFileEvent[] = [
      { kind: 'noteOn', atMs: 500, midi: 64, velocity: 0.3, hand: 'left' },
      { kind: 'sustain', atMs: 600, value: 1 },
      { kind: 'noteOff', atMs: 1_000, midi: 64 },
    ];

    expect(thePlayingAtAnotherPace(events, click(0, 500, 4), 240).events).toEqual([
      { kind: 'noteOn', atMs: 250, midi: 64, velocity: 0.3, hand: 'left' },
      { kind: 'sustain', atMs: 300, value: 1 },
      { kind: 'noteOff', atMs: 500, midi: 64 },
    ]);
  });

  it('gives back what a click that says nothing, or no pace, cannot move', () => {
    const events = struck(0, 500);
    const silent = click(0, 600, 1);
    const beats = click(0, 500, 4);

    expect(thePlayingAtAnotherPace(events, silent, 60)).toEqual({ events, beats: silent });
    expect(thePlayingAtAnotherPace(events, beats, 0).events).toBe(events);
    expect(thePlayingAtAnotherPace(events, beats, Number.NaN).events).toBe(events);
  });
});

describe('the key a file is written in', () => {
  it('writes the key at the start, its flats as a negative byte and minor as one', () => {
    const marks = (bytes: Uint8Array): number[][] =>
      written(bytes)
        .filter((each) => each.bytes[0] === 0xff && each.bytes[1] === 0x59)
        .map((each) => [each.tick, ...each.bytes.slice(3)]);

    expect(marks(writeMidiFile(struck(0, 500), { key: { fifths: -3, minor: true } }))).toEqual([[0, 0xfd, 1]]);
    expect(marks(writeMidiFile(struck(0, 500), { key: { fifths: 2, minor: false } }))).toEqual([[0, 2, 0]]);
    expect(marks(writeMidiFile(struck(0, 500)))).toEqual([]);

    const read = readMidiFile(writeMidiFile(struck(0, 500), { key: { fifths: -3, minor: true } }));
    expect([read.fifths, read.minor]).toEqual([-3, true]);
  });
});

describe('a file of two hands', () => {
  /** A track's events, by its place among the file's tracks. */
  function trackOf(bytes: Uint8Array, which: number): Uint8Array {
    let at = 14;
    for (let track = 0; ; track += 1) {
      const length = ((bytes[at + 4] ?? 0) << 24) | ((bytes[at + 5] ?? 0) << 16) | ((bytes[at + 6] ?? 0) << 8) | (bytes[at + 7] ?? 0);
      if (track === which) {
        // Put back behind a header of its own, so the format 0 readers here read it.
        return Uint8Array.from([...bytes.slice(0, 14), ...bytes.slice(at, at + 8 + length)]);
      }
      at += 8 + length;
    }
  }

  it('gives each hand a track of its own, named, where any note says which hand plays it', () => {
    const events: MidiFileEvent[] = [
      { kind: 'sustain', atMs: 0, value: 1 },
      // Said: a high note the left hand plays.
      { kind: 'noteOn', atMs: 0, midi: 72, velocity: 0.5, hand: 'left' },
      // Not said: each the hand its pitch is in, middle C the right's.
      { kind: 'noteOn', atMs: 0, midi: 59, velocity: 0.5 },
      { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.5 },
      { kind: 'noteOff', atMs: 500, midi: 72 },
      { kind: 'noteOff', atMs: 500, midi: 60 },
      { kind: 'noteOff', atMs: 3_000, midi: 59 },
    ];
    // The pace doubles at 2.5 s, after the right hand has finished.
    const beats = [...click(0, 500, 5), ...click(2_500, 250, 4, 4, 1)];
    const bytes = writeMidiFile(events, { beats });

    expect([...bytes.slice(8, 12)]).toEqual([0, 1, 0, 2]);
    const read = readMidiFile(bytes);
    expect(read.trackNames).toEqual([TRACK_OF_A_HAND.right, TRACK_OF_A_HAND.left]);
    expect(read.notes.map((note) => [note.midi, note.track])).toEqual([
      [59, 1],
      [60, 0],
      [72, 1],
    ]);
    expect(read.notes.find((note) => note.midi === 59)?.endTicks).toBe(7 * BEAT);
    // The pedal goes with the right hand, and so do the tempo and the bars -
    // to the end of the file, past where that hand stops.
    const right = trackOf(bytes, 0);
    const left = trackOf(bytes, 1);
    expect(readMidiFile(right).pedal).toHaveLength(1);
    expect(temposIn(right)).toEqual([
      { tick: 0, microseconds: 500_000 },
      { tick: 5 * BEAT, microseconds: 250_000 },
    ]);
    expect(temposIn(left)).toEqual([]);
    expect(barsIn(right)).toEqual([{ tick: 0, beats: 4 }]);
  });

  it('writes one track as it always did where no note says', () => {
    const events = struck(0, 500);

    expect(writeMidiFile(events, { trackName: 'Idea' })).toEqual(
      writeMidiFile(events.map((event) => ({ ...event })), { trackName: 'Idea' }),
    );
    expect([...writeMidiFile(events).slice(8, 12)]).toEqual([0, 0, 0, 1]);
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

describe('a click changed from a bar on', () => {
  /** Each beat as when it falls, its place in its bar and its bar's metre. */
  const laid = (beats: readonly HeardBeat[]): string[] =>
    beats.map((beat) => `${String(Math.round(beat.atMs))} ${String(beat.beat)}/${String(beat.beatsInBar)}:${String(beat.beatType ?? 4)}`);
  /** Eight bars of 4/4 at 120, a note struck on every crotchet. */
  const EIGHT_BARS = click(0, 500, 4);
  const PLAYED = struck(...Array.from({ length: 32 }, (_, at) => at * 500));
  const metres = (beats: readonly HeardBeat[]): string[] =>
    theChangesOfTheClick(PLAYED, beats).flatMap((change) =>
      change.metre === undefined ? [] : [`${String(change.atMs)} ${String(change.metre.beatsInBar)}/${String(change.metre.beatType)}`],
    );

  it('counts the bars from the one a moment is in in another metre, every moment where it was, to the end', () => {
    // Asked a moment into the third bar: from its first beat.
    const three = theClickInAnotherMetre(PLAYED, EIGHT_BARS, 3, 4, 4_200);
    expect(laid(three).slice(6, 12)).toEqual(['3000 2/4:4', '3500 3/4:4', '4000 0/3:4', '4500 1/3:4', '5000 2/3:4', '5500 0/3:4']);
    // Before it, the bars as they were.
    expect(laid(three).slice(0, 8)).toEqual(laid(theClickOfTheTake(PLAYED, EIGHT_BARS) ?? []).slice(0, 8));
    expect(metres(three)).toEqual(['0 4/4', '4000 3/4']);
    // Asked of no moment, from the first bar, as the metre of the whole was.
    expect(metres(theClickInAnotherMetre(PLAYED, EIGHT_BARS, 6, 8))).toEqual(['0 6/8']);
  });

  it('goes as far as the next change, which begins on the bar line after the last whole bar, in its own metre', () => {
    const later = theClickInAnotherMetre(PLAYED, EIGHT_BARS, 2, 4, 8_000);
    expect(metres(later)).toEqual(['0 4/4', '8000 2/4']);
    // Bars of 3/4 from the start: the fourth would cross into the change at
    // eight seconds, so it is laid whole and the change begins after it.
    const crossing = theClickInAnotherMetre(PLAYED, later, 3, 4);
    expect(metres(crossing)).toEqual(['0 3/4', '9000 2/4']);
    // Bars of 2/4 from the start reach it exactly.
    expect(metres(theClickInAnotherMetre(PLAYED, later, 2, 4))).toEqual(['0 2/4']);
    // A change in the middle, and the one after stays.
    expect(metres(theClickInAnotherMetre(PLAYED, later, 6, 8, 2_000))).toEqual(['0 4/4', '2000 6/8', '8000 2/4']);
  });

  it('takes a change away by counting its bars as the ones before are, and joins the one after where it is the same', () => {
    const changed = theClickInAnotherMetre(PLAYED, EIGHT_BARS, 3, 4, 4_000);
    expect(metres(theClickInAnotherMetre(PLAYED, changed, 4, 4, 4_000))).toEqual(['0 4/4']);
    const middle = theClickInAnotherMetre(PLAYED, theClickInAnotherMetre(PLAYED, changed, 4, 4, 10_000), 2, 4, 6_000);
    // Six seconds in is the bar of 3/4 begun at five and a half; its 2/4 bars
    // reach ten seconds mid-bar, so the 4/4 after begins a crotchet later.
    expect(metres(middle)).toEqual(['0 4/4', '4000 3/4', '5500 2/4', '10500 4/4']);
  });

  it('plays the bars from the one a moment is in at another pace as far as the next change of pace, the rest moved by as much', () => {
    // From the third bar at 60: twice as long, to the end; before it nothing moves.
    const slow = thePlayingAtAnotherPace(PLAYED, EIGHT_BARS, 60, 4_100);
    const struckAt = (events: readonly MidiFileEvent[]): number[] =>
      events.filter((event) => event.kind === 'noteOn').map((event) => Math.round(event.atMs));
    expect(struckAt(slow.events).slice(6, 10)).toEqual([3_000, 3_500, 4_000, 5_000]);
    expect(theChangesOfTheClick(slow.events, slow.beats).map((change) => [change.atMs, change.crotchetsPerMinute])).toEqual([
      [0, 120],
      [4_000, 60],
    ]);
    // Then the fifth bar at 90: from the third to the fifth bar stays at 60,
    // and from the fifth on goes at 90.
    const fifth = struckAt(slow.events)[16] ?? 0;
    const then = thePlayingAtAnotherPace(slow.events, slow.beats, 90, fifth);
    // Now the third bar at 120 again, which takes its change away: the fifth
    // bar and on keep their 90, moved earlier by the four seconds saved.
    const back = thePlayingAtAnotherPace(then.events, then.beats, 120, 4_000);
    expect(theChangesOfTheClick(back.events, back.beats).map((change) => [change.atMs, change.crotchetsPerMinute])).toEqual([
      [0, 120],
      [8_000, 90],
    ]);
    const after = struckAt(back.events);
    expect(after.slice(15, 18)).toEqual([7_500, 8_000, 8_667]);
  });

  it('marks where the click changes, and not where its beats are a millisecond out', () => {
    const wobbly = EIGHT_BARS.map((beat, at) => ({ ...beat, atMs: beat.atMs + (at % 2 === 0 ? 0 : 1) }));
    expect(theChangesOfTheClick(PLAYED, wobbly)).toEqual([{ atMs: 0, metre: { beatsInBar: 4, beatType: 4 }, crotchetsPerMinute: 120 }]);
    expect(theChangesOfTheClick(PLAYED, click(0, 600, 1))).toEqual([]);
  });

  it('says the beat a moment is on or after: its bar and which beat of it, metre and pace, and theirs before it, even past the playing', () => {
    const changed = theClickInAnotherMetre(PLAYED, EIGHT_BARS, 3, 4, 4_000);
    expect(theBeatOfTheClickAt(PLAYED, changed, 5_600)).toEqual({
      atMs: 5_500,
      bar: 4,
      beat: 0,
      metre: { beatsInBar: 3, beatType: 4 },
      crotchetsPerMinute: 120,
      before: { metre: { beatsInBar: 3, beatType: 4 }, crotchetsPerMinute: 120 },
    });
    expect(theBeatOfTheClickAt(PLAYED, changed, 4_000)?.before?.metre).toEqual({ beatsInBar: 4, beatType: 4 });
    // Every moment of the bar after its first beat: on its own beat, or the one before.
    const slowed = thePlayingAtAnotherPace(PLAYED, changed, 60, 6_000);
    for (let atMs = 5_500; atMs < 8_000; atMs += 50) {
      const beat = theBeatOfTheClickAt(slowed.events, slowed.beats, atMs);
      const on = atMs < 6_000 ? 0 : atMs < 7_000 ? 1 : 2;
      expect([beat?.bar, beat?.beat, beat?.atMs]).toEqual([4, on, [5_500, 6_000, 7_000][on]]);
    }
    expect(theBeatOfTheClickAt(slowed.events, slowed.beats, 6_000)?.before).toEqual({ metre: { beatsInBar: 3, beatType: 4 }, crotchetsPerMinute: 120 });
    expect(theBeatOfTheClickAt(slowed.events, slowed.beats, 6_000)?.crotchetsPerMinute).toBe(60);
    // A moment a hair before the bar line, as a beat worked out in crotchets may fall, is the bar's.
    expect(theBeatOfTheClickAt(PLAYED, changed, 3_999.8)?.bar).toBe(3);
    expect(theBeatOfTheClickAt(PLAYED, changed, 3_999.8)?.beat).toBe(0);
    expect(theBeatOfTheClickAt(PLAYED, changed, 0)?.before).toBeNull();
    // A minute on, well past the last note, the click carried on to it.
    expect(theBeatOfTheClickAt(PLAYED, changed, 60_000)?.bar).toBe(4 + Math.floor((60_000 - 5_500) / 1_500));
    expect(theBeatOfTheClickAt(PLAYED, click(0, 600, 1), 0)).toBeNull();
    // A click whose last two beats fall together goes no further, and is not waited on for ever.
    const stalled = [...click(0, 500, 2), { atMs: 500, beat: 2, beatsInBar: 4 }];
    expect(theBeatOfTheClickAt(PLAYED, stalled, 60_000)?.bar).toBe(1);
  });

  it('changes the pace from the last beat of a click, where the playing ends, and from a beat past it', () => {
    // Two bars of crotchets, the click's last beat on the bar line they end at.
    const played = struck(...Array.from({ length: 8 }, (_, at) => at * 500));
    const nine = click(0, 500, 9);
    for (const fromMs of [4_000, 3_999.8, 6_000]) {
      const slow = thePlayingAtAnotherPace(played, nine, 90, fromMs);
      expect(
        theChangesOfTheClick(slow.events, slow.beats).map((change) => [change.atMs, change.crotchetsPerMinute]),
        String(fromMs),
      ).toEqual([
        [0, 120],
        [fromMs === 6_000 ? 6_000 : 4_000, 90],
      ]);
      // What was played stays where it was.
      expect(slow.events).toEqual(played);
    }
  });

  it('plays from a beat inside a bar at another pace, the beats before it as they were, and writes the tempo where it changes', () => {
    // From the second beat of the third bar at 60.
    const slow = thePlayingAtAnotherPace(PLAYED, EIGHT_BARS, 60, 4_600);
    const struckAt = slow.events.filter((event) => event.kind === 'noteOn').map((event) => Math.round(event.atMs));
    expect(struckAt.slice(7, 11)).toEqual([3_500, 4_000, 4_500, 5_500]);
    expect(theChangesOfTheClick(slow.events, slow.beats).map((change) => [change.atMs, change.metre?.beatsInBar, change.crotchetsPerMinute])).toEqual([
      [0, 4, 120],
      [4_500, undefined, 60],
    ]);
    const document = readMidiFile(writeMidiFile(slow.events, { beats: slow.beats }));
    expect(document.tempoChanges).toEqual([{ atTicks: 9 * BEAT, tempoBpm: 60 }]);
    // The bar lines stay where they were: every fourth beat.
    expect(document.metreChanges).toEqual([]);
  });

  it('moves what was played a little before the first bar with it, and nothing before a later one', () => {
    const early = [{ kind: 'noteOn' as const, atMs: -100, midi: 60, velocity: 0.8 }, ...PLAYED];
    const firstAt = (events: readonly MidiFileEvent[]): number => Math.round(events[0]?.atMs ?? 0);
    expect(firstAt(thePlayingAtAnotherPace(early, EIGHT_BARS, 60).events)).toBe(-200);
    expect(firstAt(thePlayingAtAnotherPace(early, EIGHT_BARS, 60, 2_000).events)).toBe(-100);
  });
});

describe('the key music is in, changed from a bar', () => {
  const C_MAJOR = { fifths: 0, scale: 'major' as const };
  const G_MAJOR = { fifths: 1, scale: 'major' as const };
  const D_DORIAN = { fifths: 0, scale: 'dorian' as const };
  const notes = struck(0, 2_000, 4_000, 6_000);
  const keysOf = (events: readonly MidiFileEvent[]): string[] =>
    theKeyChangesOf(events).map((key) => `${String(key.atMs)} ${String(key.fifths)} ${key.scale}`);

  it('is the last change by then, a moment on the change being in it, or the key it begins in', () => {
    const changed = takeWithTheKeyFrom(notes, C_MAJOR, 2_000, G_MAJOR);
    expect(keysOf(changed)).toEqual(['2000 1 major']);
    expect([1_999, 1_999.8, 2_000, 5_000].map((atMs) => theKeyOfTheMusicAt(changed, C_MAJOR, atMs).fifths)).toEqual([0, 1, 1, 1]);
    expect(theKeyOfTheMusicAt(notes, D_DORIAN, 5_000)).toEqual(D_DORIAN);
    // Before every note, and ordered among them as the bar it begins is in it.
    expect(changed.findIndex((event) => event.kind === 'key')).toBe(2);
  });

  it('replaces a change there, puts none where the key does not change, and takes the next away where it is the key asked for', () => {
    const twice = takeWithTheKeyFrom(takeWithTheKeyFrom(notes, C_MAJOR, 2_000, G_MAJOR), C_MAJOR, 4_000, D_DORIAN);
    expect(keysOf(twice)).toEqual(['2000 1 major', '4000 0 dorian']);
    // Replaced.
    expect(keysOf(takeWithTheKeyFrom(twice, C_MAJOR, 2_000, { fifths: -1, scale: 'major' }))).toEqual([
      '2000 -1 major',
      '4000 0 dorian',
    ]);
    // Asked for the key before it: taken away.
    expect(keysOf(takeWithTheKeyFrom(twice, C_MAJOR, 2_000, C_MAJOR))).toEqual(['4000 0 dorian']);
    // Asked for the key the next change is to: that one changes nothing any more.
    expect(keysOf(takeWithTheKeyFrom(twice, C_MAJOR, 2_000, D_DORIAN))).toEqual(['2000 0 dorian']);
    // In the key it is in already, where none changes: nothing.
    expect(takeWithTheKeyFrom(notes, C_MAJOR, 2_000, C_MAJOR)).toEqual(notes);
  });

  it('moves with the music at another pace, and is written to a file as a key signature where it falls', () => {
    const changed = takeWithTheKeyFrom(notes, C_MAJOR, 2_000, { fifths: -2, scale: 'minor' });
    const slow = thePlayingAtAnotherPace(changed, click(0, 500, 4), 60);
    expect(keysOf(slow.events)).toEqual(['4000 -2 minor']);
    const document = readMidiFile(writeMidiFile(changed, { beats: click(0, 500, 4), key: { fifths: 0, minor: false } }));
    expect(document.keyChanges).toEqual([{ atTicks: 4 * BEAT, fifths: -2, minor: true }]);
  });
});

describe('the dynamic music is marked in, from a moment', () => {
  const notes = struck(0, 2_000, 4_000, 6_000);
  const marked = (events: readonly MidiFileEvent[]): string[] =>
    theDynamicsOf(events).map((dynamic) => `${String(dynamic.atMs)} ${dynamic.level}`);

  it('is the last marked by then, a moment on the mark being in it, or none', () => {
    const changed = takeWithTheDynamicFrom(notes, 2_000, 'f');
    expect(marked(changed)).toEqual(['2000 f']);
    expect([1_999, 1_999.8, 2_000, 5_000].map((atMs) => theDynamicAt(changed, atMs))).toEqual([null, 'f', 'f', 'f']);
    expect(theDynamicAt(notes, 5_000)).toBeNull();
    // Before the notes at its moment, as a key is.
    expect(changed.findIndex((event) => event.kind === 'dynamic')).toBe(2);
  });

  it('replaces one there, puts none where it is marked so already, takes the next away where it is the same, and is taken away by none', () => {
    const twice = takeWithTheDynamicFrom(takeWithTheDynamicFrom(notes, 2_000, 'f'), 4_000, 'p');
    expect(marked(twice)).toEqual(['2000 f', '4000 p']);
    expect(marked(takeWithTheDynamicFrom(twice, 2_000, 'mf'))).toEqual(['2000 mf', '4000 p']);
    // The same as the next: that one changes nothing any more.
    expect(marked(takeWithTheDynamicFrom(twice, 2_000, 'p'))).toEqual(['2000 p']);
    // Marked so already from before: none.
    expect(marked(takeWithTheDynamicFrom(twice, 3_000, 'f'))).toEqual(['2000 f', '4000 p']);
    // None asked for: the one there taken away, and the next, the same as the one before now, too.
    expect(marked(takeWithTheDynamicFrom(takeWithTheDynamicFrom(twice, 6_000, 'f'), 4_000, null))).toEqual(['2000 f']);
    expect(marked(takeWithTheDynamicFrom(twice, 2_000, null))).toEqual(['4000 p']);
    expect(takeWithTheDynamicFrom(notes, 2_000, null)).toEqual(notes);
  });

  it('moves with the music at another pace, and is written to a file as a text the reader takes back as it was', () => {
    const changed = takeWithTheDynamicFrom(takeWithTheDynamicFrom(notes, 0, 'p'), 2_000, 'ff');
    expect(marked(thePlayingAtAnotherPace(changed, click(0, 500, 4), 60).events)).toEqual(['0 p', '4000 ff']);
    const document = readMidiFile(writeMidiFile(changed, { beats: click(0, 500, 4), trackName: 'Marked' }));
    expect(document.dynamics).toEqual([
      { atTicks: 0, level: 'p' },
      { atTicks: 4 * BEAT, level: 'ff' },
    ]);
    // A dynamic's text is not the file's title, and any other text is not a dynamic.
    expect(document.title).toBe('Marked');
    const untitled = readMidiFile(writeMidiFile(changed, { beats: click(0, 500, 4) }));
    expect(untitled.title).toBeNull();
  });
});

describe('how loud a note written at a level is struck', () => {
  it('is its level, a share of the way to the next one up or down, and no further than the ends', () => {
    expect(theVelocityOfTheLevel('mf', 0)).toBe(DYNAMIC_VELOCITY.mf);
    expect(theVelocityOfTheLevel('mf', 100)).toBeCloseTo(DYNAMIC_VELOCITY.f, 9);
    expect(theVelocityOfTheLevel('mf', -100)).toBeCloseTo(DYNAMIC_VELOCITY.mp, 9);
    expect(theVelocityOfTheLevel('mf', 50)).toBeCloseTo((DYNAMIC_VELOCITY.mf + DYNAMIC_VELOCITY.f) / 2, 9);
    expect(theVelocityOfTheLevel('mf', -25)).toBeCloseTo(DYNAMIC_VELOCITY.mf + (DYNAMIC_VELOCITY.mp - DYNAMIC_VELOCITY.mf) / 4, 9);
    // Past a whole level, no further; at the ends, nowhere further to go.
    expect(theVelocityOfTheLevel('mf', 300)).toBeCloseTo(DYNAMIC_VELOCITY.f, 9);
    expect(theVelocityOfTheLevel('ffff', 80)).toBe(DYNAMIC_VELOCITY.ffff);
    expect(theVelocityOfTheLevel('n', -80)).toBe(DYNAMIC_VELOCITY.n);
  });

  it('follows the dynamic marked over it, a level of its own, or as it was played', () => {
    const notes: MidiFileEvent[] = [
      { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.1, loudness: { level: null, shade: 0 } },
      { kind: 'noteOff', atMs: 400, midi: 60 },
      { kind: 'noteOn', atMs: 1_000, midi: 62, velocity: 0.1, loudness: { level: null, shade: 50 } },
      { kind: 'noteOff', atMs: 1_400, midi: 62 },
      { kind: 'noteOn', atMs: 1_000, midi: 64, velocity: 0.1, loudness: { level: 'pp', shade: 0 } },
      { kind: 'noteOff', atMs: 1_400, midi: 64 },
      { kind: 'noteOn', atMs: 1_000, midi: 67, velocity: 0.1 },
      { kind: 'noteOff', atMs: 1_400, midi: 67 },
    ];
    const struck = (events: readonly MidiFileEvent[]): number[] =>
      events.flatMap((event) => (event.kind === 'noteOn' ? [event.velocity] : []));

    // None marked: mezzo-forte.
    expect(struck(takeWithTheLoudnessWritten(notes))).toEqual([
      DYNAMIC_VELOCITY.mf,
      theVelocityOfTheLevel('mf', 50),
      DYNAMIC_VELOCITY.pp,
      0.1,
    ]);
    // Forte from the second note on: it follows; the first, before it, does not.
    expect(struck(takeWithTheLoudnessWritten(takeWithTheDynamicFrom(notes, 1_000, 'f')))).toEqual([
      DYNAMIC_VELOCITY.mf,
      theVelocityOfTheLevel('f', 50),
      DYNAMIC_VELOCITY.pp,
      0.1,
    ]);
    // Nothing to change, the same events.
    const written = takeWithTheLoudnessWritten(notes);
    expect(takeWithTheLoudnessWritten(written)).toBe(written);
  });
});

describe('an empty bar put in before another', () => {
  it('moves everything from the bar line on by a bar, what begins on it with what follows and what ends on it with what went before', () => {
    const events: MidiFileEvent[] = [
      ...struck(0),
      // Ending on the bar line, and held across it.
      { kind: 'noteOn', atMs: 3_500, midi: 62, velocity: 0.5 },
      { kind: 'noteOff', atMs: 4_000, midi: 62 },
      { kind: 'noteOn', atMs: 3_800, midi: 64, velocity: 0.5 },
      { kind: 'noteOff', atMs: 4_200, midi: 64 },
      // The pedal let up on the bar line and put down again on it.
      { kind: 'sustain', atMs: 4_000, value: 0 },
      { kind: 'sustain', atMs: 4_000, value: 1 },
      // A hair before the bar line is on it; a key and a dynamic go with the music.
      { kind: 'noteOn', atMs: 3_999.6, midi: 67, velocity: 0.5 },
      { kind: 'noteOff', atMs: 4_400, midi: 67 },
      { kind: 'key', atMs: 4_000, fifths: 1, scale: 'major' },
      { kind: 'dynamic', atMs: 5_000, level: 'f' },
    ];
    // Asked anywhere in the third bar: before it.
    const { events: moved, beats } = thePlayingWithABarInserted(events, click(0, 500, 2), 5_200);
    const where = (kind: MidiFileEvent['kind']): string[] =>
      moved.flatMap((event) =>
        event.kind !== kind
          ? []
          : [`${String(event.atMs)}${event.kind === 'noteOn' || event.kind === 'noteOff' ? ` ${String(event.midi)}` : event.kind === 'sustain' ? ` ${String(event.value)}` : ''}`],
      );

    expect(where('noteOn')).toEqual(['0 60', '3500 62', '3800 64', '5999.6 67']);
    expect(where('noteOff')).toEqual(['1 60', '4000 62', '6200 64', '6400 67']);
    expect(where('sustain')).toEqual(['4000 0', '6000 1']);
    expect([...where('key'), ...where('dynamic')]).toEqual(['6000', '7000']);
    // Four bars of four now, the third the one put in.
    expect(beats.slice(0, 17).map((beat) => `${String(beat.atMs)}:${String(beat.beat)}`)).toEqual(
      Array.from({ length: 17 }, (_, at) => `${String(at * 500)}:${String(at % 4)}`),
    );
  });

  it('is in the metre and at the pace of the bar it goes before, and the bars after keep theirs', () => {
    const notes = struck(0, 5_000);
    const waltz = theClickInAnotherMetre(notes, click(0, 500, 2), 3, 4, 2_000);
    const paced = thePlayingAtAnotherPace(notes, waltz, 90, 2_000);
    const { events, beats } = thePlayingWithABarInserted(paced.events, paced.beats, 2_100);
    const said = (changes: readonly { readonly atMs: number; readonly metre?: { readonly beatsInBar: number }; readonly crotchetsPerMinute?: number }[]): string[] =>
      changes.map((change) => `${String(Math.round(change.atMs))} ${String(change.metre?.beatsInBar ?? '')} ${String(change.crotchetsPerMinute ?? '')}`);

    expect(said(theChangesOfTheClick(paced.events, paced.beats))).toEqual(['0 4 120', '2000 3 90']);
    expect(said(theChangesOfTheClick(events, beats))).toEqual(['0 4 120', '2000 3 90']);
    // Three crotchets at 90 a minute: two seconds.
    expect(events.filter((event) => event.kind === 'noteOn').map((event) => Math.round(event.atMs))).toEqual([
      0,
      Math.round((paced.events.find((event) => event.kind === 'noteOn' && event.atMs > 0)?.atMs ?? 0) + 2_000),
    ]);
  });

  it('goes past the last note as well, and gives back a take the click says nothing of as it was', () => {
    const notes = struck(0);
    const { events, beats } = thePlayingWithABarInserted(notes, click(0, 500, 2), 8_000);
    expect(events).toEqual(notes);
    expect(
      beats.filter((beat) => beat.atMs >= 7_500 && beat.atMs <= 10_500).map((beat) => `${String(beat.atMs)}:${String(beat.beat)}`),
    ).toEqual(['7500:3', '8000:0', '8500:1', '9000:2', '9500:3', '10000:0', '10500:1']);
    const silent = [{ atMs: 0, beat: 0, beatsInBar: 4 }];
    expect(thePlayingWithABarInserted(notes, silent, 2_000)).toEqual({ events: notes, beats: silent });
  });
});

describe('a dynamic reached gradually from the one before', () => {
  const follower = (atMs: number, shade = 0): MidiFileEvent[] => [
    { kind: 'noteOn', atMs, midi: 60, velocity: 0.1, loudness: { level: null, shade } },
    { kind: 'noteOff', atMs: atMs + 100, midi: 60 },
  ];
  const struck = (events: readonly MidiFileEvent[]): number[] =>
    takeWithTheLoudnessWritten(events).flatMap((event) => (event.kind === 'noteOn' ? [event.velocity] : []));

  it('is marked so only where there is a dynamic before it to come from', () => {
    const notes = [...follower(0), ...follower(2_000)];
    const from = takeWithTheDynamicFrom(notes, 0, 'p');
    expect(theDynamicsOf(takeWithTheDynamicFrom(from, 2_000, 'f', true))).toEqual([
      { atMs: 0, level: 'p' },
      { atMs: 2_000, level: 'f', gradually: true },
    ]);
    expect(theDynamicsOf(takeWithTheDynamicFrom(notes, 2_000, 'f', true))).toEqual([{ atMs: 2_000, level: 'f' }]);
    // Asked again at once, at once.
    expect(theDynamicsOf(takeWithTheDynamicFrom(takeWithTheDynamicFrom(from, 2_000, 'f', true), 2_000, 'f'))).toEqual([
      { atMs: 0, level: 'p' },
      { atMs: 2_000, level: 'f' },
    ]);
  });

  it('strikes the notes that follow the dynamics on the way, as far along as each is, and none else', () => {
    const notes: MidiFileEvent[] = [
      ...follower(0),
      ...follower(1_000),
      ...follower(1_500, 50),
      ...follower(2_000),
      ...follower(3_000),
      { kind: 'noteOn', atMs: 1_000, midi: 64, velocity: 0.1, loudness: { level: 'pp', shade: 0 } },
      { kind: 'noteOff', atMs: 1_100, midi: 64 },
      { kind: 'noteOn', atMs: 1_000, midi: 67, velocity: 0.1 },
      { kind: 'noteOff', atMs: 1_100, midi: 67 },
    ];
    const marked = takeWithTheDynamicFrom(takeWithTheDynamicFrom(notes, 0, 'p'), 2_000, 'f', true);
    const between = (from: number, to: number, share: number): number => from + (to - from) * share;

    expect(struck(marked)).toEqual([
      DYNAMIC_VELOCITY.p,
      between(DYNAMIC_VELOCITY.p, DYNAMIC_VELOCITY.f, 0.5),
      DYNAMIC_VELOCITY.pp,
      0.1,
      between(theVelocityOfTheLevel('p', 50), theVelocityOfTheLevel('f', 50), 0.75),
      DYNAMIC_VELOCITY.f,
      DYNAMIC_VELOCITY.f,
    ]);
    // At once, a step on its beat.
    expect(struck(takeWithTheDynamicFrom(marked, 2_000, 'f'))).toEqual([
      DYNAMIC_VELOCITY.p,
      DYNAMIC_VELOCITY.p,
      DYNAMIC_VELOCITY.pp,
      0.1,
      theVelocityOfTheLevel('p', 50),
      DYNAMIC_VELOCITY.f,
      DYNAMIC_VELOCITY.f,
    ]);
    // One said so with nothing before it, as a file may, comes from nowhere: at once.
    expect(struck([...follower(500), { kind: 'dynamic', atMs: 1_000, level: 'f', gradually: true }, ...follower(1_000)])).toEqual([
      DYNAMIC_VELOCITY.mf,
      DYNAMIC_VELOCITY.f,
    ]);
  });

  it('is written to a file as a text saying so, and read back so', () => {
    const marked = takeWithTheDynamicFrom(takeWithTheDynamicFrom([...follower(0), ...follower(2_000)], 0, 'p'), 2_000, 'f', true);
    expect(readMidiFile(writeMidiFile(marked, { beats: click(0, 500, 4) })).dynamics).toEqual([
      { atTicks: 0, level: 'p' },
      { atTicks: 4 * BEAT, level: 'f', gradually: true },
    ]);
  });
});

describe('the dynamics printed for one hand alone', () => {
  const OWN = (level: NoteLoudness['level']): NoteLoudness => ({ level, shade: 0 });
  const FOLLOWS: NoteLoudness = { level: null, shade: 0 };
  const struck = (atMs: number, midi: number, loudness?: NoteLoudness, hand?: 'right' | 'left'): MidiFileEvent[] => [
    {
      kind: 'noteOn',
      atMs,
      midi,
      velocity: 0.5,
      ...(loudness === undefined ? {} : { loudness }),
      ...(hand === undefined ? {} : { hand }),
    },
    { kind: 'noteOff', atMs: atMs + 400, midi },
  ];
  const said = (events: readonly MidiFileEvent[]): string[] =>
    theDynamicsOfEachHand(events).map((mark) => `${String(mark.atMs)} ${mark.hand} ${mark.level}`);

  it('marks where a hand is at a level the dynamic over both does not say, and back to it after', () => {
    const events: MidiFileEvent[] = [
      { kind: 'dynamic', atMs: 0, level: 'mf' },
      ...struck(0, 72, FOLLOWS),
      ...struck(0, 48, FOLLOWS),
      // Its own forte, said once however long it lasts, and the left hand left as it is.
      ...struck(500, 72, OWN('f')),
      ...struck(1_000, 74, { level: 'f', shade: 30 }),
      ...struck(1_000, 48, FOLLOWS),
      // Back to the dynamic over it, said again; a note played reads as it.
      ...struck(1_500, 72, FOLLOWS),
      ...struck(1_700, 74),
      ...struck(1_500, 48, OWN('p')),
      // A dynamic over both says it for both, so a level of its own the same says nothing.
      { kind: 'dynamic', atMs: 2_000, level: 'p' },
      ...struck(2_000, 72, OWN('p')),
      ...struck(2_500, 48, FOLLOWS),
      // And after one of its own, the next dynamic over both is what the hand is in again.
      ...struck(3_000, 72, OWN('f')),
      { kind: 'dynamic', atMs: 3_500, level: 'ff' },
      ...struck(3_500, 72, FOLLOWS),
      // A moment at the level most of its notes are at, and the louder of two as many.
      ...struck(4_000, 55, FOLLOWS),
      ...struck(4_000, 48, OWN('f')),
      ...struck(4_000, 52, OWN('f')),
      ...struck(4_500, 76, OWN('pp')),
      ...struck(4_500, 72, OWN('p')),
      // The hand a note is said to be in, or the one its pitch is in.
      ...struck(5_000, 40, OWN('ff')),
      ...struck(5_500, 64, OWN('fff'), 'left'),
      // One of its own on the moment of a dynamic over both outlasts it.
      { kind: 'dynamic', atMs: 6_000, level: 'mp' },
      ...struck(6_000, 72, OWN('f')),
      ...struck(6_500, 72, FOLLOWS),
    ];

    expect(said(events)).toEqual([
      '500 right f',
      '1500 right mf',
      '1500 left p',
      '3000 right f',
      '4000 left f',
      '4500 right p',
      '5000 left ff',
      '5500 left fff',
      '6000 right f',
      '6500 right mp',
    ]);
  });

  it('says nothing where every note follows the dynamics over both or was played, and none marked is mezzo-forte', () => {
    expect(
      said([{ kind: 'dynamic', atMs: 0, level: 'p' }, ...struck(0, 72, FOLLOWS), ...struck(500, 48), ...struck(1_000, 72, OWN('p'))]),
    ).toEqual([]);
    expect(said([...struck(0, 72, OWN('mf')), ...struck(500, 72, OWN('f')), ...struck(1_000, 72, FOLLOWS)])).toEqual([
      '500 right f',
      '1000 right mf',
    ]);
  });

  it('is written to a file as a text saying the hand, in its track or the one there is, and read back so', () => {
    const marked = (hand: (midi: number) => 'right' | 'left' | undefined): MidiFileEvent[] => [
      { kind: 'dynamic', atMs: 0, level: 'mf' },
      ...struck(0, 72, FOLLOWS, hand(72)),
      ...struck(500, 72, OWN('f'), hand(72)),
      ...struck(500, 48, OWN('f'), hand(48)),
      ...struck(1_000, 72, FOLLOWS, hand(72)),
      ...struck(1_000, 48, FOLLOWS, hand(48)),
    ];
    const read = (events: readonly MidiFileEvent[]) => readMidiFile(writeMidiFile(events, { beats: click(0, 500, 4) }));
    const expected = [
      { atTicks: 0, level: 'mf' },
      { atTicks: BEAT, level: 'f', hand: 'right' },
      { atTicks: BEAT, level: 'f', hand: 'left' },
      { atTicks: 2 * BEAT, level: 'mf', hand: 'right' },
      { atTicks: 2 * BEAT, level: 'mf', hand: 'left' },
    ];

    const twoTracks = read(marked((midi) => (midi >= 60 ? 'right' : 'left')));
    expect(twoTracks.trackNames).toEqual([TRACK_OF_A_HAND.right, TRACK_OF_A_HAND.left]);
    expect(twoTracks.dynamics).toEqual(expected);
    expect(read(marked(() => undefined)).dynamics).toEqual(expected);
  });
});
