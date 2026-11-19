import { theKeysOfTheTake } from '../application/session/RunRoll.js';
import type { HeardBeat, MidiFileEvent } from '../domain/midi/MidiFile.js';

/** A sketch as drawn, before or after a change: its events, notes as notes, and the beats they are written against. */
export interface SketchDrawn {
  readonly events: readonly MidiFileEvent[];
  readonly beats: readonly HeardBeat[];
}

/**
 * One thing a change made or took away, on the events' clock: a note, from
 * its start to its end on its pitch, or a mark - a dynamic, a key, a part, the
 * pedal, a drum under the notes - at its moment, on no row.
 */
export interface ThingChanged {
  readonly fromMs: number;
  readonly untilMs: number;
  readonly midi: number | null;
}

/**
 * What a change to a sketch made or took away: every note and mark there is
 * on one side of it and not on the other. A note moved is two - where it was
 * and where it went - and one made louder is the same note twice.
 *
 * Nothing where the beats changed: a new metre or pace moves every note
 * written against them, and the change is the whole sketch rather than a
 * place in it.
 */
export function whatWasChanged(was: SketchDrawn, now: SketchDrawn): readonly ThingChanged[] {
  if (!theSameBeats(was.beats, now.beats)) {
    return [];
  }
  return [...onOneSideOnly(theThingsIn(was.events), theThingsIn(now.events)), ...onOneSideOnly(theThingsIn(now.events), theThingsIn(was.events))];
}

/** A thing of a sketch, with everything that says it is the same thing as another. */
interface ThingSaid {
  readonly thing: ThingChanged;
  readonly said: string;
}

function theThingsIn(events: readonly MidiFileEvent[]): readonly ThingSaid[] {
  const notes = theKeysOfTheTake(events).map((key) => ({
    thing: { fromMs: key.downAtMs, untilMs: key.upAtMs ?? key.downAtMs, midi: key.midi },
    said: JSON.stringify(['note', key.midi, key.downAtMs, key.upAtMs, key.velocity, key.hand ?? null, key.loudness ?? null]),
  }));
  const marks = events
    .filter((event) => event.kind !== 'noteOn' && event.kind !== 'noteOff')
    .map((event) => ({ thing: { fromMs: event.atMs, untilMs: event.atMs, midi: null }, said: JSON.stringify(event) }));
  return [...notes, ...marks];
}

/** The things of one side the other has no match for, each match used once: a chord struck twice over is two. */
function onOneSideOnly(one: readonly ThingSaid[], other: readonly ThingSaid[]): readonly ThingChanged[] {
  const left = new Map<string, number>();
  for (const each of other) {
    left.set(each.said, (left.get(each.said) ?? 0) + 1);
  }
  return one.flatMap((each) => {
    const matches = left.get(each.said) ?? 0;
    if (matches > 0) {
      left.set(each.said, matches - 1);
      return [];
    }
    return [each.thing];
  });
}

function theSameBeats(one: readonly HeardBeat[], other: readonly HeardBeat[]): boolean {
  return (
    one.length === other.length &&
    one.every((beat, index) => {
      const its = other[index];
      return (
        its !== undefined &&
        beat.atMs === its.atMs &&
        beat.beat === its.beat &&
        beat.beatsInBar === its.beatsInBar &&
        beat.beatType === its.beatType
      );
    })
  );
}

/** Where the drawing is scrolled to and how much of it the screen shows, in pixels. */
export interface TheView {
  readonly x: number;
  readonly y: number;
  readonly widePx: number;
  readonly tallPx: number;
}

/** How the drawing is laid out: where its time begins on the events' clock, how wide a second is, how tall a row, and the pitch on the top one. */
export interface TheLayout {
  readonly beganAtMs: number;
  readonly pxPerSecond: number;
  readonly rowPx: number;
  readonly highest: number;
}

/**
 * How far in from the left of the screen a change scrolled to is put: a
 * tenth of the width, so what comes before it is seen too and its first note
 * is not against the edge.
 */
export const A_CHANGE_STANDS_IN = 0.1;

/**
 * Where to scroll so a change can be seen, or `null` to leave the view alone:
 * left where any of it is on the screen, so an undo made beside the notes
 * being worked on never moves them.
 *
 * Scrolled only along what hides it - across, so the change begins a tenth
 * in; down, so its pitches are in the middle. A mark is on no row, and is
 * seen at any height.
 */
export function whereToSeeTheChange(changed: readonly ThingChanged[], view: TheView, layout: TheLayout): { x: number; y: number } | null {
  if (changed.length === 0 || view.widePx <= 0 || view.tallPx <= 0) {
    return null;
  }
  const across = (ms: number): number => ((ms - layout.beganAtMs) / 1000) * layout.pxPerSecond;
  const top = (midi: number): number => (layout.highest - midi) * layout.rowPx;
  const seenAcross = (thing: ThingChanged): boolean =>
    across(thing.untilMs) >= view.x && across(thing.fromMs) <= view.x + view.widePx;
  const seenDown = (thing: ThingChanged): boolean =>
    thing.midi === null || (top(thing.midi) + layout.rowPx > view.y && top(thing.midi) < view.y + view.tallPx);
  if (changed.some((thing) => seenAcross(thing) && seenDown(thing))) {
    return null;
  }
  const x = changed.some((thing) => seenAcross(thing))
    ? view.x
    : Math.max(0, across(Math.min(...changed.map((thing) => thing.fromMs))) - view.widePx * A_CHANGE_STANDS_IN);
  // Down to the pitches of what is in the time on the screen from there.
  const inTime = changed.filter((thing) => across(thing.untilMs) >= x && across(thing.fromMs) <= x + view.widePx);
  if (inTime.some((thing) => seenDown(thing))) {
    return { x, y: view.y };
  }
  const pitches = inTime.flatMap((thing) => (thing.midi === null ? [] : [thing.midi]));
  const middle = (top(Math.max(...pitches)) + top(Math.min(...pitches)) + layout.rowPx) / 2;
  return { x, y: Math.max(0, middle - view.tallPx / 2) };
}
