import { SCALES, type ScaleName } from '../harmony/scales.js';
import { DYNAMIC_LEVELS, DYNAMIC_VELOCITY, type DynamicLevel } from '../model/Exercise.js';
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
      /**
       * How loud it is written, where it is: its velocity then follows from
       * it (see `takeWithTheLoudnessWritten`). None, and it is as loud as it
       * was struck - a note played rather than written.
       */
      readonly loudness?: NoteLoudness;
    }
  | { readonly kind: 'noteOff'; readonly atMs: number; readonly midi: number }
  | { readonly kind: 'sustain'; readonly atMs: number; readonly value: number }
  /**
   * The music written in another key from here: its signature and its scale.
   * Nothing a hand plays - a file says it as a mark, as it says a tempo -
   * but kept among the events so that it moves with the music it is in.
   */
  | { readonly kind: 'key'; readonly atMs: number; readonly fifths: number; readonly scale: ScaleName }
  /**
   * How loud the music is written from here: a dynamic, as a score marks
   * one. Nothing a hand plays either, and kept among the events for the same
   * reason a key is - it moves with the music it is in.
   */
  | {
      readonly kind: 'dynamic';
      readonly atMs: number;
      readonly level: DynamicLevel;
      /**
       * Reached gradually from the dynamic marked before it, rather than at
       * once here: a hairpin from that one to this. Only ever said of one
       * with a dynamic before it.
       */
      readonly gradually?: true;
    }
  /**
   * A part of the piece beginning here, by the name the writer gave it - a
   * letter, A or B, or a word, Verse or Chorus - as far as the next. Nothing
   * a hand plays, kept among the events as a key is, to move with the music
   * it is in.
   */
  | { readonly kind: 'section'; readonly atMs: number; readonly name: string };

/** The two hands, as the two staves of a piano score are theirs. */
export type Hand = 'left' | 'right';

/**
 * The lowest key of the right hand, for a note nothing says the hand of:
 * middle C, where the two staves of a piano score meet.
 */
export const HANDS_SPLIT_AT_MIDI = 60;

/** The hand that plays a note: the one it is said to be in, or the one its pitch is in. */
export function theHandThatPlays(note: { readonly midi: number; readonly hand?: Hand }): Hand {
  return note.hand ?? (note.midi >= HANDS_SPLIT_AT_MIDI ? 'right' : 'left');
}

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
 * The beats of a take's click, carried on past its playing as far as a
 * moment, where it is later: so a bar after the last note can be changed.
 * And a beat past it, where asked: a pace is the gap after a beat, and the
 * last beat has none to change.
 */
function theClickReaching(
  events: readonly MidiFileEvent[],
  beats: readonly HeardBeat[],
  atMs: number,
  andABeatPast = false,
): readonly HeardBeat[] | null {
  let grid = theClickOfTheTake(events, beats);
  const short = (last: HeardBeat): boolean => last.atMs < atMs || (andABeatPast && last.atMs <= atMs + SAME_MOMENT_MS);
  for (let after = 0; grid !== null && short(elementAt(grid, grid.length - 1)); ) {
    after += 8;
    const longer = theClickOfTheTake(events, beats, after);
    // A click that goes nowhere goes no further.
    if (longer === null || longer.length === grid.length) {
      break;
    }
    grid = longer;
  }
  return grid;
}

/** The beat a bar begins on, of the bar a moment is in: the first bar's for a moment before it. */
function theBarAt(grid: readonly HeardBeat[], atMs: number): number {
  let bar = 0;
  grid.forEach((beat, at) => {
    if (beat.beat === 0 && beat.atMs <= atMs + SAME_MOMENT_MS) {
      bar = at;
    }
  });
  return bar;
}

/** The beat a moment is on or after: the first beat for a moment before it. */
function theBeatAt(grid: readonly HeardBeat[], atMs: number): number {
  let on = 0;
  grid.forEach((beat, at) => {
    if (beat.atMs <= atMs + SAME_MOMENT_MS) {
      on = at;
    }
  });
  return on;
}

/** How near two moments are to be one: what rounding a click's beats to the millisecond leaves. */
const SAME_MOMENT_MS = 0.5;

/** A metre as a bar says it: "6/8". */
function metreOf(beat: HeardBeat): string {
  return `${String(beat.beatsInBar)}/${String(valueOf(beat))}`;
}

/** How many crotchets a minute the beat at `at` goes at, to the nearest one: the pace a tempo mark would say. */
function thePaceOfTheBeat(grid: readonly HeardBeat[], at: number): number {
  return Math.round((MILLISECONDS_PER_MINUTE * 4) / valueOf(elementAt(grid, at)) / gapAfter(grid, at));
}

/**
 * The beats of a click with the bars from the one a moment is in counted in
 * another metre, as far as the next bar that changes metre - or to the end.
 *
 * Every moment stays where it was, at the same pace, so the notes stay where
 * they were played or put and only the bars they are written in change. The
 * bars are laid whole: where the last of them would cross into the next
 * change, that change begins on the bar line after it, in its own metre. A
 * metre the bars before were in already is no change: they go on in it.
 * Where the click says nothing it is given back as it was. Asked of no
 * moment, from the first bar.
 */
export function theClickInAnotherMetre(
  events: readonly MidiFileEvent[],
  beats: readonly HeardBeat[],
  beatsInBar: number,
  beatType: number,
  fromMs = Number.NEGATIVE_INFINITY,
): readonly HeardBeat[] {
  const grid = theClickReaching(events, beats, fromMs);
  if (grid === null) {
    return beats;
  }
  const marks = theCrotchetsOfTheClick(grid);
  const from = theBarAt(grid, fromMs);
  // The metres the click is in, each from where it begins, in crotchets.
  const sections: { crotchets: number; beatsInBar: number; beatType: number }[] = [];
  grid.forEach((beat, at) => {
    const begins = at === 0 || (beat.beat === 0 && metreOf(beat) !== metreOf(elementAt(grid, at - 1)));
    if (begins || at === from) {
      sections.push({ crotchets: elementAt(marks.points, at).crotchets, beatsInBar: beat.beatsInBar, beatType: valueOf(beat) });
    }
  });
  const asked = elementAt(marks.points, from).crotchets;
  // Two sections side by side in one metre lay the bars one would: the
  // bars of the first are whole, so the second's begin where its would.
  const kept = sections.map((section) =>
    section.crotchets === asked ? { ...section, beatsInBar, beatType } : section,
  );
  const counted: HeardBeat[] = [];
  let at = 0;
  kept.forEach((section, index) => {
    const next = kept[index + 1];
    const unit = 4 / section.beatType;
    for (let beat = 0; next === undefined ? at < marks.crotchets : at < next.crotchets || beat !== 0; ) {
      counted.push({ atMs: theMomentOfACrotchet(marks.points, at), beat, beatsInBar: section.beatsInBar, beatType: section.beatType });
      at += unit;
      beat = (beat + 1) % section.beatsInBar;
    }
  });
  return counted;
}

/** Where a click changes, from its first bar: what a mark over the bar says, a metre or a pace or both. */
export interface ClickChange {
  readonly atMs: number;
  /** The metre its bars are in from here, where it changes here. */
  readonly metre?: { readonly beatsInBar: number; readonly beatType: number };
  /** Crotchets a minute from here, to the nearest one, where the pace changes here. */
  readonly crotchetsPerMinute?: number;
}

/**
 * Every place a take's click changes metre or pace, from its first beat,
 * which says both: what the marks over the bars say. A pace is the nearest
 * whole crotchets a minute, so a click's beats rounded to the millisecond
 * are not each a change. Nothing where the click says nothing.
 */
export function theChangesOfTheClick(events: readonly MidiFileEvent[], beats: readonly HeardBeat[]): readonly ClickChange[] {
  const grid = theClickOfTheTake(events, beats);
  if (grid === null) {
    return [];
  }
  return grid.flatMap((beat, at): ClickChange[] => {
    const before = grid[at - 1];
    // A bar's beats are all in its metre, so a change of metre is always a bar's first beat.
    const metre =
      at === 0 || (before !== undefined && metreOf(beat) !== metreOf(before))
        ? { beatsInBar: beat.beatsInBar, beatType: valueOf(beat) }
        : undefined;
    const pace = thePaceOfTheBeat(grid, at);
    const crotchetsPerMinute = at === 0 || pace !== thePaceOfTheBeat(grid, at - 1) ? pace : undefined;
    return metre === undefined && crotchetsPerMinute === undefined
      ? []
      : [{ atMs: beat.atMs, ...(metre === undefined ? {} : { metre }), ...(crotchetsPerMinute === undefined ? {} : { crotchetsPerMinute }) }];
  });
}

/** A key as the music is written in it: its signature, and its scale. */
export interface KeyOfTheMusic {
  readonly fifths: number;
  readonly scale: ScaleName;
}

function sameKeyOfTheMusic(one: KeyOfTheMusic, other: KeyOfTheMusic): boolean {
  return one.fifths === other.fifths && one.scale === other.scale;
}

/**
 * The key music is in at a moment: the last it changed to by then, a moment
 * on the change itself being in it - or the key it begins in.
 */
export function theKeyOfTheMusicAt(
  events: readonly MidiFileEvent[],
  begunIn: KeyOfTheMusic,
  atMs: number,
): KeyOfTheMusic {
  let key = begunIn;
  for (const event of events) {
    if (event.kind === 'key' && event.atMs <= atMs + SAME_MOMENT_MS) {
      key = { fifths: event.fifths, scale: event.scale };
    }
  }
  return key;
}

/**
 * The music written in a key from a moment, as far as the next change of
 * key: a change already there replaced, none put where the key does not
 * change, and the next change taken away where it is to the key now asked
 * for - it changes nothing any more.
 */
export function takeWithTheKeyFrom(
  events: readonly MidiFileEvent[],
  begunIn: KeyOfTheMusic,
  atMs: number,
  key: KeyOfTheMusic,
): readonly MidiFileEvent[] {
  const here = (event: MidiFileEvent): boolean => event.kind === 'key' && Math.abs(event.atMs - atMs) <= SAME_MOMENT_MS;
  const kept = events.filter((event) => !here(event));
  // With the change there gone, the key at that moment is the one before it.
  const before = theKeyOfTheMusicAt(kept, begunIn, atMs);
  const next = kept.find((event) => event.kind === 'key' && event.atMs > atMs);
  const changes = !sameKeyOfTheMusic(before, key);
  const joined = kept.filter(
    (event) => event !== next || event.kind !== 'key' || !sameKeyOfTheMusic({ fifths: event.fifths, scale: event.scale }, key),
  );
  return inTheOrderPlayed(changes ? [...joined, { kind: 'key', atMs, fifths: key.fifths, scale: key.scale }] : joined);
}

/** The dynamic music is written in at a moment: the last marked by then, one on the moment being in it - or none. */
export function theDynamicAt(events: readonly MidiFileEvent[], atMs: number): DynamicLevel | null {
  let level: DynamicLevel | null = null;
  for (const event of events) {
    if (event.kind === 'dynamic' && event.atMs <= atMs + SAME_MOMENT_MS) {
      level = event.level;
    }
  }
  return level;
}

/**
 * The music marked with a dynamic from a moment, as far as the next: one
 * already there replaced, none put where the music is in it already, and the
 * next taken away where it is the same - it changes nothing any more. With no
 * dynamic asked for, the one there is taken away, and the music is in the one
 * before.
 */
export function takeWithTheDynamicFrom(
  events: readonly MidiFileEvent[],
  atMs: number,
  level: DynamicLevel | null,
  gradually = false,
): readonly MidiFileEvent[] {
  const here = (event: MidiFileEvent): boolean => event.kind === 'dynamic' && Math.abs(event.atMs - atMs) <= SAME_MOMENT_MS;
  const kept = events.filter((event) => !here(event));
  const before = theDynamicAt(kept, atMs);
  const now = level ?? before;
  const next = kept.find((event) => event.kind === 'dynamic' && event.atMs > atMs);
  const joined = kept.filter((event) => event !== next || event.kind !== 'dynamic' || event.level !== now);
  if (level === null || level === before) {
    return inTheOrderPlayed(joined);
  }
  // Gradually only from a dynamic before it: with none, there is nothing to come from.
  return inTheOrderPlayed([...joined, { kind: 'dynamic', atMs, level, ...(gradually && before !== null ? { gradually: true } : {}) }]);
}

/** The name of the section beginning at a moment, or nothing where none does. */
export function theSectionAt(events: readonly MidiFileEvent[], atMs: number): string {
  for (const event of events) {
    if (event.kind === 'section' && Math.abs(event.atMs - atMs) <= SAME_MOMENT_MS) {
      return event.name;
    }
  }
  return '';
}

/**
 * The music with a section beginning at a moment, by a name: one already
 * beginning there renamed, and with no name - nothing but spaces - taken
 * away, the music there in the section before it.
 */
export function takeWithTheSectionAt(events: readonly MidiFileEvent[], atMs: number, name: string): readonly MidiFileEvent[] {
  const kept = events.filter((event) => event.kind !== 'section' || Math.abs(event.atMs - atMs) > SAME_MOMENT_MS);
  const named = name.trim();
  return inTheOrderPlayed(named === '' ? kept : [...kept, { kind: 'section', atMs, name: named }]);
}

/** Where each section of the music begins, and its name, in time order. */
export function theSectionsOf(events: readonly MidiFileEvent[]): readonly { readonly atMs: number; readonly name: string }[] {
  return events.flatMap((event) => (event.kind === 'section' ? [{ atMs: event.atMs, name: event.name }] : []));
}

/** Where music is marked with a dynamic, and which, and whether reached gradually, in time order. */
export function theDynamicsOf(
  events: readonly MidiFileEvent[],
): readonly { readonly atMs: number; readonly level: DynamicLevel; readonly gradually?: true }[] {
  return events.flatMap((event) =>
    event.kind === 'dynamic' ? [{ atMs: event.atMs, level: event.level, ...(event.gradually === true ? { gradually: true as const } : {}) }] : [],
  );
}

/**
 * A dynamic as a MIDI file says one: there is no event of its own for it,
 * so a text event saying so, which a sequencer shows among its markers and
 * this program's reader takes back as the dynamic it was. One for a hand
 * alone says which.
 */
export function theTextOfADynamic(level: DynamicLevel, hand: Hand | null = null, gradually = false): string {
  return `dynamic ${level}${hand === null ? '' : `, ${hand} hand`}${gradually ? ', gradually' : ''}`;
}

/**
 * The dynamic a text event says, the hand it is for if one alone, and
 * whether it is reached gradually, as `theTextOfADynamic` writes it; `null`
 * where it says anything else.
 */
export function theDynamicATextSays(
  text: string,
): { readonly level: DynamicLevel; readonly hand: Hand | null; readonly gradually: boolean } | null {
  const said = /^dynamic (\w+)(?:, (right|left) hand)?(, gradually)?$/.exec(text.trim());
  const level = DYNAMIC_LEVELS.find((each) => each === said?.[1]);
  const hand = said?.[2];
  return level === undefined
    ? null
    : { level, hand: hand === 'right' || hand === 'left' ? hand : null, gradually: said?.[3] !== undefined };
}

/**
 * Where one hand's music is printed at a level the dynamics over both do not
 * say, and which: a note's own level, and back to the dynamic over it after.
 * Each hand on its own, as a pianist reads a mark against one staff: what the
 * page says for it is the last dynamic over both, or the last of its own
 * since. A moment's notes are at the level most of them are at, the louder
 * of two as many; a note played, at none, reads as the dynamic over it.
 */
export function theDynamicsOfEachHand(
  events: readonly MidiFileEvent[],
): readonly { readonly atMs: number; readonly level: DynamicLevel; readonly hand: Hand }[] {
  const ordered = inTheOrderPlayed(events);
  const marks: { atMs: number; level: DynamicLevel; hand: Hand }[] = [];
  for (const hand of ['right', 'left'] as const) {
    const moments: { atMs: number; levels: DynamicLevel[] }[] = [];
    for (const event of ordered) {
      if (event.kind !== 'noteOn' || theHandThatPlays(event) !== hand) {
        continue;
      }
      const level = event.loudness === undefined ? (theDynamicAt(ordered, event.atMs) ?? LOUDNESS_UNMARKED) : theLevelOfTheNote(ordered, event.atMs, event.loudness);
      const last = moments[moments.length - 1];
      if (last !== undefined && event.atMs - last.atMs <= SAME_MOMENT_MS) {
        last.levels.push(level);
      } else {
        moments.push({ atMs: event.atMs, levels: [level] });
      }
    }
    let own: { readonly atMs: number; readonly level: DynamicLevel } | null = null;
    for (const moment of moments) {
      const overBoth = ordered.filter((event) => event.kind === 'dynamic' && event.atMs <= moment.atMs + SAME_MOMENT_MS);
      const since = overBoth[overBoth.length - 1]?.atMs ?? -Infinity;
      const says: DynamicLevel = own !== null && own.atMs >= since ? own.level : (theDynamicAt(ordered, moment.atMs) ?? LOUDNESS_UNMARKED);
      const count = (level: DynamicLevel): number => moment.levels.filter((each) => each === level).length;
      const level = moment.levels.reduce((best, each) =>
        count(each) > count(best) || (count(each) === count(best) && DYNAMIC_LEVELS.indexOf(each) > DYNAMIC_LEVELS.indexOf(best)) ? each : best,
      );
      if (level !== says) {
        own = { atMs: moment.atMs, level };
        marks.push({ atMs: moment.atMs, level, hand });
      }
    }
  }
  return marks.sort((one, other) => one.atMs - other.atMs);
}

/**
 * How loud a note is written: at a level - its own, or none, which is the
 * dynamic the music is marked in where it is struck - and a share of the
 * way from it to the level next to it, in hundredths: up towards the louder
 * one, down towards the softer. Kept as a level and a share rather than as a
 * velocity, so the levels can be heard otherwise one day and every note
 * written at one goes with them.
 */
export interface NoteLoudness {
  readonly level: DynamicLevel | null;
  readonly shade: number;
}

/** The level a note following the marks is at where none is marked yet. */
export const LOUDNESS_UNMARKED: DynamicLevel = 'mf';

/** How hard a level is struck, `0..1`, a share of the way to the next level up or down. */
export function theVelocityOfTheLevel(level: DynamicLevel, shade: number): number {
  const at = DYNAMIC_LEVELS.indexOf(level);
  const toward = DYNAMIC_LEVELS[at + Math.sign(shade)] ?? level;
  const from = DYNAMIC_VELOCITY[level];
  return from + (DYNAMIC_VELOCITY[toward] - from) * Math.min(1, Math.abs(shade) / 100);
}

/**
 * How hard a note written at a level is struck: its own level, or the
 * dynamic it is in - and on the way to the next where that one is reached
 * gradually, as far along as the note is from the one before it to that one.
 */
function theVelocityWritten(events: readonly MidiFileEvent[], atMs: number, loudness: NoteLoudness): number {
  if (loudness.level !== null) {
    return theVelocityOfTheLevel(loudness.level, loudness.shade);
  }
  const dynamics = theDynamicsOf(events);
  const next = dynamics.findIndex((dynamic) => dynamic.atMs > atMs + SAME_MOMENT_MS);
  const from = next === -1 ? dynamics[dynamics.length - 1] : dynamics[next - 1];
  const to = dynamics[next];
  const ground = theVelocityOfTheLevel(from?.level ?? LOUDNESS_UNMARKED, loudness.shade);
  if (from === undefined || to?.gradually !== true) {
    return ground;
  }
  return ground + (theVelocityOfTheLevel(to.level, loudness.shade) - ground) * ((atMs - from.atMs) / (to.atMs - from.atMs));
}

/** The level a note written at one is at: its own, or the dynamic it is in, or the unmarked one. */
export function theLevelOfTheNote(events: readonly MidiFileEvent[], atMs: number, loudness: NoteLoudness): DynamicLevel {
  return loudness.level ?? theDynamicAt(events, atMs) ?? LOUDNESS_UNMARKED;
}

/**
 * The events with every note written at a level struck as hard as it says:
 * the one place a written note's velocity comes from, so a dynamic marked,
 * moved or taken away is heard in every note that follows it. A note played
 * keeps the velocity it was struck with.
 */
export function takeWithTheLoudnessWritten(events: readonly MidiFileEvent[]): readonly MidiFileEvent[] {
  let changed = false;
  const written = events.map((event) => {
    if (event.kind !== 'noteOn' || event.loudness === undefined) {
      return event;
    }
    const velocity = theVelocityWritten(events, event.atMs, event.loudness);
    if (velocity === event.velocity) {
      return event;
    }
    changed = true;
    return { ...event, velocity };
  });
  return changed ? written : events;
}

/** Where music changes key, and to what, in time order. */
export function theKeyChangesOf(events: readonly MidiFileEvent[]): readonly ({ readonly atMs: number } & KeyOfTheMusic)[] {
  return events.flatMap((event) => (event.kind === 'key' ? [{ atMs: event.atMs, fifths: event.fifths, scale: event.scale }] : []));
}

/**
 * The beat of a take's click a moment is on or after, as a mark on it would
 * be asked about: when it falls, the bar it is in and which beat of it, the
 * metre and the pace there - and what they were on the beat before, which
 * taking a change away gives back. `null` where the click says nothing.
 */
export function theBeatOfTheClickAt(
  events: readonly MidiFileEvent[],
  beats: readonly HeardBeat[],
  atMs: number,
): {
  readonly atMs: number;
  readonly bar: number;
  /** Which beat of its bar, the first being nought: a metre changes only on that one. */
  readonly beat: number;
  readonly metre: { readonly beatsInBar: number; readonly beatType: number };
  readonly crotchetsPerMinute: number;
  readonly before: { readonly metre: { readonly beatsInBar: number; readonly beatType: number }; readonly crotchetsPerMinute: number } | null;
} | null {
  const grid = theClickReaching(events, beats, atMs);
  if (grid === null) {
    return null;
  }
  const on = theBeatAt(grid, atMs);
  const here = elementAt(grid, on);
  const before = grid[on - 1];
  return {
    atMs: here.atMs,
    bar: grid.slice(0, on + 1).filter((beat) => beat.beat === 0).length,
    beat: here.beat,
    metre: { beatsInBar: here.beatsInBar, beatType: valueOf(here) },
    crotchetsPerMinute: thePaceOfTheBeat(grid, on),
    before:
      before === undefined
        ? null
        : { metre: { beatsInBar: before.beatsInBar, beatType: valueOf(before) }, crotchetsPerMinute: thePaceOfTheBeat(grid, on - 1) },
  };
}

/**
 * How many crotchets a minute a click goes at where it begins: the pace a
 * tempo mark would say. Null where the click says nothing.
 */
export function thePaceOfTheClick(events: readonly MidiFileEvent[], beats: readonly HeardBeat[]): number | null {
  const grid = theClickOfTheTake(events, beats);
  if (grid === null) {
    return null;
  }
  const [first, second] = theCrotchetsOfTheClick(grid).points;
  return first === undefined || second === undefined
    ? null
    : (MILLISECONDS_PER_MINUTE * (second.crotchets - first.crotchets)) / (second.atMs - first.atMs);
}

/**
 * Some playing at another pace from the beat a moment is on or after, as far
 * as the next beat whose pace is another - or to the end: every note, every
 * pedal and every beat there moved to where the same place in the bar falls
 * at that many crotchets a minute, from that beat, which stays. A pace may
 * change on any beat, as a tempo mark may stand over any note. The notes
 * keep their places in the bars and their lengths in beats, and the music
 * goes faster or slower there; before it nothing moves, and after it
 * everything keeps its own pace and moves by as much as the end of the
 * change did. Where the click says nothing it is given back as it was.
 * Asked of no moment, from the first bar - and what was played a little
 * before it moves with it.
 */
export function thePlayingAtAnotherPace(
  events: readonly MidiFileEvent[],
  beats: readonly HeardBeat[],
  crotchetsPerMinute: number,
  fromMs = Number.NEGATIVE_INFINITY,
): { readonly events: readonly MidiFileEvent[]; readonly beats: readonly HeardBeat[] } {
  const grid = theClickReaching(events, beats, fromMs, true);
  if (grid === null || !(crotchetsPerMinute > 0)) {
    return { events, beats };
  }
  const { points } = theCrotchetsOfTheClick(grid);
  const on = theBeatAt(grid, fromMs);
  let next = on + 1;
  while (next < grid.length && thePaceOfTheBeat(grid, next) === thePaceOfTheBeat(grid, next - 1)) {
    next += 1;
  }
  const from = elementAt(points, on);
  const until = points[next];
  const perCrotchet = MILLISECONDS_PER_MINUTE / crotchetsPerMinute;
  const by = until === undefined ? 0 : from.atMs + (until.crotchets - from.crotchets) * perCrotchet - until.atMs;
  const moved = (atMs: number): number => {
    if (on > 0 && atMs < from.atMs) {
      return atMs;
    }
    if (until !== undefined && atMs >= until.atMs) {
      return atMs + by;
    }
    return from.atMs + (theCrotchetAtAMoment(points, atMs) - from.crotchets) * perCrotchet;
  };
  return {
    events: events.map((event) => ({ ...event, atMs: moved(event.atMs) })),
    beats: grid.map((beat) => ({ ...beat, atMs: moved(beat.atMs) })),
  };
}

const MILLISECONDS_PER_MINUTE = 60_000;

/**
 * A take with an empty bar put in before the bar a moment is in: the same
 * metre and pace as that bar, and everything from its first beat on moved
 * later by as long as it lasts - the notes, the pedal, the keys and the
 * dynamics, and the beats. What begins on that bar line moves with the music
 * after it, and what ends there stays with the music before; a note or the
 * pedal held across it is held across the bar put in too. Where the click
 * says nothing it is given back as it was.
 */
export function thePlayingWithABarInserted(
  events: readonly MidiFileEvent[],
  beats: readonly HeardBeat[],
  atMs: number,
): { readonly events: readonly MidiFileEvent[]; readonly beats: readonly HeardBeat[] } {
  const grid = theClickReaching(events, beats, atMs, true);
  if (grid === null) {
    return { events, beats };
  }
  const from = theBarAt(grid, atMs);
  const first = elementAt(grid, from);
  // The bar and the beat after it, carried on at its pace where the click stops short of them.
  const laid = [...grid];
  while (laid.length <= from + first.beatsInBar) {
    const last = elementAt(laid, laid.length - 1);
    laid.push({ ...last, atMs: last.atMs + gapAfter(laid, laid.length - 1), beat: (last.beat + 1) % last.beatsInBar });
  }
  const lengthMs = elementAt(laid, from + first.beatsInBar).atMs - first.atMs;
  const begins = (event: MidiFileEvent): boolean =>
    event.kind === 'noteOn' || event.kind === 'key' || event.kind === 'dynamic' || (event.kind === 'sustain' && damperIsDown(event.value));
  const moves = (event: MidiFileEvent): boolean =>
    event.atMs > first.atMs + SAME_MOMENT_MS || (event.atMs >= first.atMs - SAME_MOMENT_MS && begins(event));
  return {
    events: inTheOrderPlayed(events.map((event) => (moves(event) ? { ...event, atMs: event.atMs + lengthMs } : event))),
    beats: [
      ...laid.slice(0, from + first.beatsInBar),
      ...laid.slice(from).map((beat) => ({ ...beat, atMs: beat.atMs + lengthMs })),
    ],
  };
}

/** A beat of a click: how many crotchets after its first it falls, and when. */
interface CrotchetMark {
  readonly crotchets: number;
  readonly atMs: number;
}

/** Where each beat of a click is, in crotchets from the first, and when; and how many crotchets its beats hold. */
function theCrotchetsOfTheClick(grid: readonly HeardBeat[]): {
  readonly points: readonly CrotchetMark[];
  readonly crotchets: number;
} {
  const points: CrotchetMark[] = [];
  let crotchets = 0;
  for (const beat of grid) {
    points.push({ crotchets, atMs: beat.atMs });
    crotchets += 4 / valueOf(beat);
  }
  return { points, crotchets };
}

/**
 * The two beats of a click a place falls between - or, before the first or
 * after the last, the two nearest it, their pace carried on as the click
 * itself is carried on.
 */
function theBeatsAround(points: readonly CrotchetMark[], isPast: (mark: CrotchetMark) => boolean): [CrotchetMark, CrotchetMark] {
  let segment = 0;
  while (segment + 2 < points.length && isPast(elementAt(points, segment + 1))) {
    segment += 1;
  }
  return [elementAt(points, segment), elementAt(points, segment + 1)];
}

/** When a place so many crotchets after a click's first beat falls. */
function theMomentOfACrotchet(points: readonly CrotchetMark[], at: number): number {
  const [from, to] = theBeatsAround(points, (mark) => mark.crotchets <= at);
  return from.atMs + ((at - from.crotchets) * (to.atMs - from.atMs)) / (to.crotchets - from.crotchets);
}

/** How many crotchets after a click's first beat a moment falls. */
function theCrotchetAtAMoment(points: readonly CrotchetMark[], atMs: number): number {
  const [from, to] = theBeatsAround(points, (mark) => mark.atMs <= atMs);
  return from.crotchets + ((atMs - from.atMs) * (to.crotchets - from.crotchets)) / (to.atMs - from.atMs);
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

/**
 * Rank at one instant: a key first, as the bar it begins is in it; then a
 * release, which must be written before the next press.
 */
function orderAt(event: MidiFileEvent): number {
  switch (event.kind) {
    case 'key':
    case 'dynamic':
    case 'section':
      return -1;
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

  // Where a hand is printed at a level of its own, said in the track it is
  // played in, or the one there is.
  const ofEachHand = theDynamicsOfEachHand(ordered).map(
    (mark): WrittenInATrack => ({ kind: 'dynamicOfAHand', atMs: mark.atMs, level: mark.level, hand: mark.hand }),
  );
  const ofTheHand = (hand: Hand): readonly WrittenInATrack[] => ofEachHand.filter((mark) => mark.kind === 'dynamicOfAHand' && mark.hand === hand);
  const hands = theHandsOf(ordered);
  if (hands === null) {
    return theFile(0, [
      theTrack(withTheMarksOfAHand(ordered, ofEachHand), { marks, opening, name: options.trackName, tickOf: ticks(), lastTick }),
    ]);
  }
  return theFile(1, [
    // The tempo and the bars go with the first, as a conductor's do.
    theTrack(withTheMarksOfAHand(hands.right, ofTheHand('right')), { marks, opening, name: TRACK_OF_A_HAND.right, tickOf: ticks(), lastTick }),
    theTrack(withTheMarksOfAHand(hands.left, ofTheHand('left')), { marks: [], opening: [], name: TRACK_OF_A_HAND.left, tickOf: ticks(), lastTick }),
  ]);
}

/** What a track is written from: the events, and the dynamics of a hand alone, which no event of a take holds. */
type WrittenInATrack =
  | MidiFileEvent
  | { readonly kind: 'dynamicOfAHand'; readonly atMs: number; readonly level: DynamicLevel; readonly hand: Hand };

/** A track's events with a hand's marks among them, each after whatever else is at its moment, the marks before it included. */
function withTheMarksOfAHand(
  events: readonly MidiFileEvent[],
  marks: readonly WrittenInATrack[],
): readonly WrittenInATrack[] {
  const written: WrittenInATrack[] = [...events];
  for (const mark of marks) {
    const at = written.findIndex((event) => event.atMs > mark.atMs);
    written.splice(at === -1 ? written.length : at, 0, mark);
  }
  return written;
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
  ordered: readonly WrittenInATrack[],
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
      case 'key':
        track.push(...keyMark({ fifths: event.fifths, minor: SCALES[event.scale].minor }));
        break;
      case 'dynamic':
      case 'dynamicOfAHand': {
        const text = [
          ...new TextEncoder().encode(
            event.kind === 'dynamic'
              ? theTextOfADynamic(event.level, null, event.gradually === true)
              : theTextOfADynamic(event.level, event.hand),
          ),
        ];
        track.push(0xff, 0x01, ...variableLength(text.length), ...text);
        break;
      }
      case 'section': {
        // A marker, which is what a sequencer names a part of the piece with.
        const text = [...new TextEncoder().encode(event.name)];
        track.push(0xff, 0x06, ...variableLength(text.length), ...text);
        break;
      }
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
