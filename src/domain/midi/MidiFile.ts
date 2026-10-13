import { elementAt } from '../../shared/asserts.js';
import { DomainError } from '../../shared/errors.js';

/**
 * One thing that happened at the keyboard, in the terms a file needs.
 *
 * Deliberately not `MidiEvent` from the input port: that one carries where it
 * came from and when it was delivered, neither of which belongs in a file.
 */
export type MidiFileEvent =
  | {
      readonly kind: 'noteOn';
      readonly atMs: number;
      readonly midi: number;
      readonly velocity: number;
      /** Which hand plays it, where that has been said: see {@link HANDS_SPLIT_AT_MIDI}. */
      readonly hand?: Hand;
    }
  | { readonly kind: 'noteOff'; readonly atMs: number; readonly midi: number }
  | { readonly kind: 'sustain'; readonly atMs: number; readonly value: number };

/** The two hands, as the two staves of a piano score are theirs. */
export type Hand = 'left' | 'right';

/**
 * The lowest key of the right hand, for a note nothing says the hand of:
 * middle C, where the two staves of a piano score meet.
 */
export const HANDS_SPLIT_AT_MIDI = 60;

/** What each hand's track is called in a file, which is how a reader knows it. */
export const TRACK_OF_A_HAND: Readonly<Record<Hand, string>> = {
  right: 'Right hand',
  left: 'Left hand',
};

/**
 * A beat of a click the playing was heard against, on the same clock as the
 * events.
 */
export interface HeardBeat {
  readonly atMs: number;
  /** Its place in its bar, the first beat being 0. */
  readonly beat: number;
  /** How many beats the bar it is in has. */
  readonly beatsInBar: number;
  /**
   * The value its beat is written as, as a time signature's lower number
   * says it: 8 for a bar of quavers. A crotchet where nothing says, which is
   * what a metronome's click is.
   */
  readonly beatType?: number;
}

export interface MidiFileOptions {
  /**
   * The tempo the file declares.
   *
   * Free playing has no tempo to discover, so one is declared rather than
   * guessed and the notes are placed in real time against it. Anything
   * opening the file sees the rhythm that was actually played; a wrong guess
   * would move the notes, and a capture that moves the notes is not a
   * capture.
   */
  readonly tempoBpm?: number;
  readonly trackName?: string;
  /**
   * The click the playing was heard against, in the order its beats were
   * heard, which says where its beats and bars are, so nothing has to be
   * guessed: see {@link theBeatsFromTheFirstBar}. Given two beats apart it
   * takes the place of `tempoBpm`.
   */
  readonly beats?: readonly HeardBeat[];
  /**
   * The key the music is in, written for whatever opens the file to spell its
   * notes in: sharps positive and flats negative, as MIDI counts them.
   */
  readonly key?: { readonly fifths: number; readonly minor: boolean };
}

const DEFAULT_TEMPO_BPM = 120;
const MICROSECONDS_PER_MINUTE = 60_000_000;

/**
 * Ticks to the quarter in the files this writes.
 *
 * Its own number, not the notation's divisions. They were the same once and
 * that was a coincidence: a capture is placed in real time and carries no
 * notated values at all, so how finely a septuplet has to divide is nothing
 * to do with it. 480 is what a sequencer expects to see in a header, and a
 * capture is meant to be opened by other programs.
 */
const TICKS_PER_QUARTER = 480;

/** Halfway on a damper pedal, where the felt reaches the strings. */
const DAMPER_HALFWAY = 64;

/**
 * Whether the dampers are off the strings, from a pedal reading.
 *
 * MIDI's own convention is that 64 and above is "on", and for a switch that
 * is fine because a switch only ever says 0 or 127. A keyboard that reports
 * how far the pedal has travelled says 64 on the way through, in both
 * directions - so a foot that comes up and goes straight back down, which is
 * how a pianist changes the pedal, is reported as `127, 64, 127` with no
 * zero in it at all. Read by the convention that would be no movement, and
 * the change of harmony the reader made with their foot is thrown away.
 *
 * Halfway is where the felt begins to touch, so halfway is read as touching.
 * A switch pedal is unaffected: it never reports the middle.
 */
export function damperIsDown(value: number): boolean {
  return Math.round(value * 127) > DAMPER_HALFWAY;
}

/** MIDI's 7-bit range, with 0 reserved: a note-on of 0 is a note-off. */
function toVelocity(normalised: number): number {
  return Math.min(127, Math.max(1, Math.round(normalised * 127)));
}

function toController(normalised: number): number {
  return Math.min(127, Math.max(0, Math.round(normalised * 127)));
}

/**
 * MIDI's variable-length quantity: seven bits per byte, high bit as "more".
 *
 * Delta times are written this way, which is what keeps a file of mostly
 * small gaps small.
 */
function variableLength(value: number): number[] {
  if (value < 0 || !Number.isInteger(value)) {
    throw new DomainError(`A delta time must be a whole number of ticks, got ${value}.`);
  }
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}

function ascii(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0) & 0x7f);
}

function uint32(value: number): number[] {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * The beats of a click from the first beat of the bar the playing begins in.
 *
 * That bar is the file's first, so a phrase begun on the third beat opens on
 * two beats of rest rather than with everything moved two beats early. A
 * first note played a little ahead of a bar's first beat is still that bar's,
 * up to half a beat early - it is the beat it was aimed at. Where the click
 * was set going after the playing began, its beats are carried back at the
 * pace and in the bars they were first heard in.
 *
 * `null` where two beats were not heard, which is the least a pace is read
 * from.
 */
export function theBeatsFromTheFirstBar(
  beats: readonly HeardBeat[],
  firstNoteMs: number,
): readonly HeardBeat[] | null {
  const heard = [...beats];
  const [first, second] = heard;
  if (!barsAreHeardIn(beats) || first === undefined || second === undefined) {
    return null;
  }
  const gap = second.atMs - first.atMs;
  for (;;) {
    for (let at = heard.length - 1; at >= 0; at -= 1) {
      const beat = elementAt(heard, at);
      if (beat.beat === 0 && beat.atMs <= firstNoteMs + gapAfter(heard, at) / 2) {
        return heard.slice(at);
      }
    }
    const earliest = elementAt(heard, 0);
    heard.unshift({
      ...earliest,
      atMs: earliest.atMs - gap,
      beat: (earliest.beat + earliest.beatsInBar - 1) % earliest.beatsInBar,
    });
  }
}

/**
 * The beats a take is written in: from the first beat of the bar its first
 * event falls in, on to its last event, the click carried on at its last
 * pace and in its last bar wherever it stopped before the playing did - and
 * `beatsAfter` more past it, where there is to be room for more.
 *
 * One answer for the file, the page read from it and the drawing of the
 * take, so the three cannot disagree about where a bar is. `null` where the
 * click says nothing: see {@link barsAreHeardIn}.
 */
export function theClickOfTheTake(
  events: readonly MidiFileEvent[],
  beats: readonly HeardBeat[],
  beatsAfter = 0,
): readonly HeardBeat[] | null {
  const firstMs = events.reduce((earliest, event) => Math.min(earliest, event.atMs), Number.POSITIVE_INFINITY);
  const lastMs = events.reduce((latest, event) => Math.max(latest, event.atMs), Number.NEGATIVE_INFINITY);
  const from = theBeatsFromTheFirstBar(beats, firstMs);
  if (from === null) {
    return null;
  }
  const carried = [...from];
  let after = beatsAfter;
  for (let last = elementAt(carried, carried.length - 1); last.atMs < lastMs || after > 0; ) {
    if (last.atMs >= lastMs) {
      after -= 1;
    }
    const gap = gapAfter(carried, carried.length - 1);
    // A pace of nothing never arrives anywhere; the click said so itself.
    if (gap <= 0) {
      break;
    }
    last = { ...last, atMs: last.atMs + gap, beat: (last.beat + 1) % last.beatsInBar };
    carried.push(last);
  }
  return carried;
}

/**
 * The beats of a click as another metre counts them: at the same pace, with
 * every moment where it was, the bars and the beats laid afresh from the
 * first beat of the first bar - so the notes stay where they were played or
 * put, and only the bars they are written in change. Where the click says
 * nothing it is given back as it was.
 */
export function theClickInAnotherMetre(
  events: readonly MidiFileEvent[],
  beats: readonly HeardBeat[],
  beatsInBar: number,
  beatType: number,
): readonly HeardBeat[] {
  const grid = theClickOfTheTake(events, beats);
  if (grid === null) {
    return beats;
  }
  // Where each beat of the click is, in crotchets from the first, and when.
  // Past the last, its pace goes on, as the click itself is carried on.
  const points: { readonly crotchets: number; readonly atMs: number }[] = [];
  let crotchets = 0;
  for (const beat of grid) {
    points.push({ crotchets, atMs: beat.atMs });
    crotchets += 4 / valueOf(beat);
  }
  const when = (at: number): number => {
    let segment = 0;
    while (segment + 2 < points.length && elementAt(points, segment + 1).crotchets <= at) {
      segment += 1;
    }
    const from = elementAt(points, segment);
    const to = elementAt(points, segment + 1);
    return from.atMs + ((at - from.crotchets) * (to.atMs - from.atMs)) / (to.crotchets - from.crotchets);
  };
  const unit = 4 / beatType;
  const counted: HeardBeat[] = [];
  for (let at = 0; at * unit < crotchets; at += 1) {
    counted.push({ atMs: when(at * unit), beat: at % beatsInBar, beatsInBar, beatType });
  }
  return counted;
}

/**
 * Whether a click says where its bars are: two beats heard apart, the
 * least a pace is read from.
 */
export function barsAreHeardIn(beats: readonly HeardBeat[]): boolean {
  const [first, second] = beats;
  return first !== undefined && second !== undefined && second.atMs > first.atMs;
}

/** How long the beat at `at` lasts: until the next, or as long as the one before it. */
function gapAfter(beats: readonly HeardBeat[], at: number): number {
  const next = beats[at + 1];
  const here = elementAt(beats, at);
  return next === undefined ? here.atMs - elementAt(beats, at - 1).atMs : next.atMs - here.atMs;
}

/**
 * Events in time order. Stable: two at the same instant keep the order they
 * arrived in, except that a release always comes before a press, so
 * re-striking a key that is still down cannot silence the note that just
 * started.
 */
export function inTheOrderPlayed(events: readonly MidiFileEvent[]): readonly MidiFileEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const byTime = left.event.atMs - right.event.atMs;
      if (byTime !== 0) {
        return byTime;
      }
      const byKind = orderAt(left.event) - orderAt(right.event);
      return byKind === 0 ? left.index - right.index : byKind;
    })
    .map(({ event }) => event);
}

/** Rank at one instant: a release must be written before the next press. */
function orderAt(event: MidiFileEvent): number {
  switch (event.kind) {
    case 'noteOff':
      return 0;
    case 'sustain':
      return 1;
    default:
      return 2;
  }
}

/** A key signature: its sharps or flats as a signed byte, and whether it is minor. */
function keyMark(key: { readonly fifths: number; readonly minor: boolean }): number[] {
  return [0xff, 0x59, 0x02, key.fifths & 0xff, key.minor ? 1 : 0];
}

function tempoMark(microsecondsPerQuarter: number): number[] {
  return [0xff, 0x51, 0x03, ...uint32(microsecondsPerQuarter).slice(1)];
}

/** A bar of `beats` crotchets, with MIDI's ordinary clock and thirty-second counts. */
/** A bar of `beats` beats of the value `beatType`, with MIDI's ordinary clock and thirty-second counts. */
function barMark(beats: number, beatType: number): number[] {
  return [0xff, 0x58, 0x04, beats & 0xff, Math.round(Math.log2(beatType)) & 0xff, 24, 8];
}

/** The value a beat is written as: a crotchet where it does not say. */
function valueOf(beat: HeardBeat): number {
  return beat.beatType ?? 4;
}

/** Ticks of a beat of its own value. */
function ticksOfABeat(beat: HeardBeat): number {
  return (TICKS_PER_QUARTER * 4) / valueOf(beat);
}

/** The tick each beat begins on, from the first: each as long as its value. */
function theTicksOfTheBeats(grid: readonly HeardBeat[]): readonly number[] {
  const starts: number[] = [];
  let tick = 0;
  for (const beat of grid) {
    starts.push(tick);
    tick += ticksOfABeat(beat);
  }
  return starts;
}

/**
 * The tempo and the bar at each beat of the click where either changes: a
 * tempo read off how long each beat lasted, as a crotchet a minute, so a
 * click sped up partway through is followed rather than averaged.
 */
function theMarksOfTheClick(
  grid: readonly HeardBeat[],
): readonly { readonly tick: number; readonly bytes: readonly number[] }[] {
  const marks: { tick: number; bytes: number[] }[] = [];
  const starts = theTicksOfTheBeats(grid);
  let tempo = -1;
  let bar = '';
  grid.forEach((beat, at) => {
    const tick = elementAt(starts, at);
    const lasts = Math.round((gapAfter(grid, at) * 1_000 * valueOf(beat)) / 4);
    if (lasts !== tempo) {
      tempo = lasts;
      marks.push({ tick, bytes: tempoMark(lasts) });
    }
    const metre = `${String(beat.beatsInBar)}/${String(valueOf(beat))}`;
    if (beat.beat === 0 && metre !== bar) {
      bar = metre;
      marks.push({ tick, bytes: barMark(beat.beatsInBar, valueOf(beat)) });
    }
  });
  return marks;
}

/**
 * Where a moment falls on the click, in ticks from its first bar: each beat
 * as long as its value, and a moment between two beats as far between them
 * as it fell.
 *
 * Asked in order of time, as the events are written, so the beat reached is
 * kept between asks.
 */
function onTheClick(grid: readonly HeardBeat[]): (ms: number) => number {
  const starts = theTicksOfTheBeats(grid);
  let at = 0;
  return (ms) => {
    while (at + 1 < grid.length && elementAt(grid, at + 1).atMs <= ms) {
      at += 1;
    }
    const beat = elementAt(grid, at);
    return Math.round(elementAt(starts, at) + (ticksOfABeat(beat) * (ms - beat.atMs)) / gapAfter(grid, at));
  };
}

/**
 * Writes a performance as a Standard MIDI File.
 *
 * Format 0 - one track, every channel in it - because a capture of one
 * keyboard is one stream, and format 0 is the shape every program reads.
 * Where any note says which hand plays it, format 1 instead: a track for
 * each hand, named so (see {@link TRACK_OF_A_HAND}), so a notation program -
 * this one included - puts each on its own staff, and a sequencer shows
 * them apart.
 *
 * Pure by design, like {@link ../notation/MusicXmlSerializer.js}: bytes in,
 * bytes out, no clock and no I/O, so a whole recording can be asserted on
 * byte for byte in a test.
 */
export function writeMidiFile(
  events: readonly MidiFileEvent[],
  options: MidiFileOptions = {},
): Uint8Array {
  const tempoBpm = options.tempoBpm ?? DEFAULT_TEMPO_BPM;
  if (tempoBpm <= 0) {
    throw new DomainError(`A tempo must be positive, got ${tempoBpm}.`);
  }
  const msPerTick = 60_000 / (tempoBpm * TICKS_PER_QUARTER);
  // A take opens on its first note; a pedal already down is said at the
  // same moment.
  const grid = options.beats === undefined ? null : theClickOfTheTake(events, options.beats);
  const marks = grid === null ? [] : theMarksOfTheClick(grid);
  // Tempo, so the notes mean the same thing wherever the file is opened. A
  // click's own is among its marks.
  const opening = [
    ...(grid === null ? [...variableLength(0), ...tempoMark(Math.round(MICROSECONDS_PER_MINUTE / tempoBpm))] : []),
    ...(options.key === undefined ? [] : [...variableLength(0), ...keyMark(options.key)]),
  ];
  // Asked again for each track: it keeps its place between asks, in time.
  const ticks = (): ((ms: number) => number) =>
    grid === null ? (ms: number) => Math.round(ms / msPerTick) : onTheClick(grid);
  const ordered = inTheOrderPlayed(events);
  const lastTick = Math.max(0, ...ordered.map((event) => Math.max(0, ticks()(event.atMs))));

  const hands = theHandsOf(ordered);
  if (hands === null) {
    return theFile(0, [theTrack(ordered, { marks, opening, name: options.trackName, tickOf: ticks(), lastTick })]);
  }
  return theFile(1, [
    // The tempo and the bars go with the first, as a conductor's do.
    theTrack(hands.right, { marks, opening, name: TRACK_OF_A_HAND.right, tickOf: ticks(), lastTick }),
    theTrack(hands.left, { marks: [], opening: [], name: TRACK_OF_A_HAND.left, tickOf: ticks(), lastTick }),
  ]);
}

/**
 * The events of each hand, where any note says which hand plays it; `null`
 * where none does. A note that does not say is the hand its pitch is in (see
 * {@link HANDS_SPLIT_AT_MIDI}), a release goes with the press it ends, and
 * the pedal with the right hand, which is the track a file's pedal is
 * looked for on first.
 */
function theHandsOf(
  ordered: readonly MidiFileEvent[],
): { readonly right: readonly MidiFileEvent[]; readonly left: readonly MidiFileEvent[] } | null {
  if (!ordered.some((event) => event.kind === 'noteOn' && event.hand !== undefined)) {
    return null;
  }
  const right: MidiFileEvent[] = [];
  const left: MidiFileEvent[] = [];
  const open = new Map<number, Hand[]>();
  const byPitch = (midi: number): Hand => (midi >= HANDS_SPLIT_AT_MIDI ? 'right' : 'left');
  for (const event of ordered) {
    let hand: Hand = 'right';
    if (event.kind === 'noteOn') {
      hand = event.hand ?? byPitch(event.midi);
      open.set(event.midi, [...(open.get(event.midi) ?? []), hand]);
    } else if (event.kind === 'noteOff') {
      hand = open.get(event.midi)?.shift() ?? byPitch(event.midi);
    }
    (hand === 'right' ? right : left).push(event);
  }
  return { right, left };
}

/** One track's bytes: its opening, its name, its events, and the marks of the click among them. */
function theTrack(
  ordered: readonly MidiFileEvent[],
  given: {
    readonly marks: readonly { readonly tick: number; readonly bytes: readonly number[] }[];
    readonly opening: readonly number[];
    readonly name: string | undefined;
    readonly tickOf: (ms: number) => number;
    /** The file's last tick, which the marks are written up to wherever this track ends. */
    readonly lastTick: number;
  },
): number[] {
  const track: number[] = [...given.opening];
  const { marks } = given;
  let previousTick = 0;
  let marked = 0;
  const markUpTo = (tick: number): void => {
    for (let mark = marks[marked]; mark !== undefined && mark.tick <= tick; mark = marks[marked]) {
      track.push(...variableLength(mark.tick - previousTick), ...mark.bytes);
      previousTick = mark.tick;
      marked += 1;
    }
  };
  const name = given.name;
  if (name !== undefined && name.length > 0) {
    const text = ascii(name);
    track.push(...variableLength(0), 0xff, 0x03, ...variableLength(text.length), ...text);
  }
  for (const event of ordered) {
    const tick = Math.max(0, given.tickOf(event.atMs));
    markUpTo(tick);
    track.push(...variableLength(Math.max(0, tick - previousTick)));
    previousTick = Math.max(previousTick, tick);
    switch (event.kind) {
      case 'noteOn':
        track.push(0x90, event.midi & 0x7f, toVelocity(event.velocity));
        break;
      case 'noteOff':
        track.push(0x80, event.midi & 0x7f, 0x40);
        break;
      case 'sustain':
        track.push(0xb0, 0x40, toController(event.value));
        break;
    }
  }
  markUpTo(given.lastTick);
  track.push(...variableLength(0), 0xff, 0x2f, 0x00);
  return track;
}

/** A file of the format and tracks given, at this writer's ticks to the quarter. */
function theFile(format: 0 | 1, tracks: readonly (readonly number[])[]): Uint8Array {
  return Uint8Array.from([
    ...ascii('MThd'),
    ...uint32(6),
    0x00,
    format,
    0x00,
    tracks.length,
    (TICKS_PER_QUARTER >> 8) & 0xff,
    TICKS_PER_QUARTER & 0xff,
    ...tracks.flatMap((track) => [...ascii('MTrk'), ...uint32(track.length), ...track]),
  ]);
}
