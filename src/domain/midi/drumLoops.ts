import { inTheOrderPlayed, type Hand, type MidiFileEvent, type NoteLoudness } from './MidiFile.js';

/*
 * Loops of a sketch's drums.
 *
 * A loop is a stretch of the drums - its first lap - played again and again
 * to as far as it is pulled, as a sequencer loops a clip: the last lap may
 * stop partway through. Its laps are written out as hits, as a repeat of a
 * score is written out rather than jumped back to, so that everything that
 * plays, draws or keeps the drums sees them as they sound. What makes them a
 * loop is that they are kept alike: a change to one lap is a change to all
 * of them (see `takeWithTheDrumLoopsKeptInStep`).
 *
 * Its edges are events of the sketch - where it begins, where its first lap
 * ends and where its last does - so a bar put in or another pace moves the
 * loop as it moves the hits.
 */

/** A loop of drums, its edges as moments of the sketch. */
export interface DrumLoop {
  /** What pairs its edges. */
  readonly id: number;
  readonly fromMs: number;
  /** Where its first lap ends: how long a lap lasts, from where it begins. */
  readonly lapMs: number;
  /** Where its last lap ends, partway through one or not. */
  readonly untilMs: number;
}

/** Moments this close are one: what is put on a line is put there in whole milliseconds. */
const SAME_MOMENT_MS = 0.5;

/**
 * The loops of a sketch's drums, in the order they begin. Only one with all
 * three edges, in their order: one whose edge a bar taken out took with it
 * is no loop.
 */
export function theDrumLoopsOf(events: readonly MidiFileEvent[]): readonly DrumLoop[] {
  const edges = new Map<number, { from?: number; lap?: number; until?: number }>();
  for (const event of events) {
    if (event.kind === 'drumLoop') {
      edges.set(event.loop, { ...edges.get(event.loop), [event.edge]: event.atMs });
    }
  }
  const loops: DrumLoop[] = [];
  for (const [id, { from, lap, until }] of edges) {
    if (from !== undefined && lap !== undefined && until !== undefined && lap > from + SAME_MOMENT_MS && until >= lap - SAME_MOMENT_MS) {
      loops.push({ id, fromMs: from, lapMs: lap, untilMs: Math.max(until, lap) });
    }
  }
  return loops.sort((one, other) => one.fromMs - other.fromMs);
}

/**
 * The drums with a loop made of a stretch of them, one lap long - to be
 * pulled out into more; or `null` where the stretch is none or runs into a
 * loop already there.
 */
export function takeWithADrumLoop(events: readonly MidiFileEvent[], fromMs: number, toMs: number): readonly MidiFileEvent[] | null {
  const loops = theDrumLoopsOf(events);
  if (toMs - fromMs < 1 || loops.some((loop) => fromMs < loop.untilMs - SAME_MOMENT_MS && loop.fromMs < toMs - SAME_MOMENT_MS)) {
    return null;
  }
  const id = Math.max(0, ...events.flatMap((event) => (event.kind === 'drumLoop' ? [event.loop] : []))) + 1;
  return inTheOrderPlayed([
    ...events,
    { kind: 'drumLoop', atMs: fromMs, loop: id, edge: 'from' },
    { kind: 'drumLoop', atMs: toMs, loop: id, edge: 'lap' },
    { kind: 'drumLoop', atMs: toMs, loop: id, edge: 'until' },
  ]);
}

/**
 * The drums with a loop pulled out to end at another moment - never short
 * of its first lap, nor into the loop after it - and its laps written to
 * there from the first.
 */
export function takeWithTheDrumLoopUntil(events: readonly MidiFileEvent[], id: number, untilMs: number): readonly MidiFileEvent[] {
  const loops = theDrumLoopsOf(events);
  const loop = loops.find((each) => each.id === id);
  if (loop === undefined) {
    return events;
  }
  const next = loops.find((each) => each.fromMs >= loop.untilMs - SAME_MOMENT_MS && each.id !== id);
  const until = Math.min(Math.max(untilMs, loop.lapMs), next?.fromMs ?? Number.POSITIVE_INFINITY);
  const source = theContentOf(theHitsOf(events), { fromMs: loop.fromMs, untilMs: loop.lapMs });
  const moved = events.map(
    (event): MidiFileEvent => (event.kind === 'drumLoop' && event.loop === id && event.edge === 'until' ? { ...event, atMs: until } : event),
  );
  // What was written past the new end, where it was pulled in, goes with it.
  return theLapsWritten(moved, { ...loop, untilMs: until }, source, Math.max(until, loop.untilMs));
}

/** The drums with a loop let go of: its hits stay as they are, and are no longer kept alike. */
export function takeWithoutTheDrumLoop(events: readonly MidiFileEvent[], id: number): readonly MidiFileEvent[] {
  return events.filter((event) => !(event.kind === 'drumLoop' && event.loop === id));
}

/**
 * The drums after a change, with every loop's laps kept alike.
 *
 * Where one lap was changed - a hit put in, moved, taken out, struck harder -
 * the change is every lap's: that lap becomes what they are copies of, and
 * the rest of the first lap past where a short last lap stops stays as it
 * was. Where every lap is still alike, as after a change of pace that moved
 * them all, nothing is done. Where more than one was changed, and not alike -
 * a box of hits moved across a lap's end - which change is meant cannot be
 * told, and the loop is let go of, its hits as the change left them. The
 * edges of a loop that is no longer one go too.
 */
export function takeWithTheDrumLoopsKeptInStep(
  before: readonly MidiFileEvent[],
  after: readonly MidiFileEvent[],
): readonly MidiFileEvent[] {
  const loops = theDrumLoopsOf(after);
  const whole = new Set(loops.map((loop) => loop.id));
  let events: readonly MidiFileEvent[] = after.filter((event) => event.kind !== 'drumLoop' || whole.has(event.loop));
  const was = theDrumLoopsOf(before);
  for (const loop of loops) {
    const hits = theHitsOf(events);
    const laps = theLapsOf(loop);
    const now = laps.map((lap) => theContentOf(hits, lap));
    const first = now[0] ?? [];
    if (laps.every((lap, at) => said(now[at] ?? []) === said(cutTo(first, lap.untilMs - lap.fromMs)))) {
      continue;
    }
    const then = was.find((each) => each.id === loop.id);
    const thenLaps = then === undefined ? [] : theLapsOf(then);
    const hitsThen = theHitsOf(before);
    const changed = laps.flatMap((_, at) => {
      const thenLap = thenLaps[at];
      return thenLap !== undefined && said(theContentOf(hitsThen, thenLap)) === said(now[at] ?? []) ? [] : [at];
    });
    const [only] = changed;
    const lap = only === undefined ? undefined : laps[only];
    const firstThen = thenLaps[0];
    if (changed.length !== 1 || only === undefined || lap === undefined || firstThen === undefined) {
      events = takeWithoutTheDrumLoop(events, loop.id);
      continue;
    }
    const length = lap.untilMs - lap.fromMs;
    const source = [...(now[only] ?? []), ...theContentOf(hitsThen, firstThen).filter((hit) => hit.afterMs >= length - SAME_MOMENT_MS)];
    events = theLapsWritten(events, loop, source, loop.untilMs);
  }
  return events;
}

/** A drum struck in a sketch, and where in its events it is. */
interface Hit {
  readonly atMs: number;
  readonly upAtMs: number | null;
  readonly midi: number;
  readonly velocity: number;
  readonly hand?: Hand;
  readonly loudness?: NoteLoudness;
  readonly on: number;
  readonly off: number | null;
}

/** The drums struck, each paired with the oldest letting go of its drum after it, as keys are. */
function theHitsOf(events: readonly MidiFileEvent[]): readonly Hit[] {
  const hits: Hit[] = [];
  const open = new Map<number, number[]>();
  events.forEach((event, at) => {
    if (event.kind === 'drumOn') {
      open.set(event.midi, [...(open.get(event.midi) ?? []), hits.length]);
      hits.push({
        atMs: event.atMs,
        upAtMs: null,
        midi: event.midi,
        velocity: event.velocity,
        ...(event.hand === undefined ? {} : { hand: event.hand }),
        ...(event.loudness === undefined ? {} : { loudness: event.loudness }),
        on: at,
        off: null,
      });
    } else if (event.kind === 'drumOff') {
      const index = open.get(event.midi)?.shift();
      const hit = index === undefined ? undefined : hits[index];
      if (index !== undefined && hit !== undefined) {
        hits[index] = { ...hit, upAtMs: event.atMs, off: at };
      }
    }
  });
  return hits;
}

/** A stretch of a loop: one lap, the last perhaps short. */
interface Lap {
  readonly fromMs: number;
  readonly untilMs: number;
}

function theLapsOf(loop: DrumLoop): readonly Lap[] {
  const length = loop.lapMs - loop.fromMs;
  const laps: Lap[] = [];
  for (let from = loop.fromMs; from < loop.untilMs - SAME_MOMENT_MS; from += length) {
    laps.push({ fromMs: from, untilMs: Math.min(from + length, loop.untilMs) });
  }
  return laps;
}

/** A hit of a lap, from its beginning, and held no further than its end. */
interface InALap {
  readonly afterMs: number;
  readonly lengthMs: number;
  readonly midi: number;
  readonly velocity: number;
  readonly hand?: Hand;
  readonly loudness?: NoteLoudness;
}

function theContentOf(hits: readonly Hit[], lap: Lap): readonly InALap[] {
  return hits
    .filter((hit) => hit.atMs >= lap.fromMs - SAME_MOMENT_MS && hit.atMs < lap.untilMs - SAME_MOMENT_MS)
    .map((hit) => ({
      afterMs: hit.atMs - lap.fromMs,
      lengthMs: Math.min(hit.upAtMs ?? lap.untilMs, lap.untilMs) - hit.atMs,
      midi: hit.midi,
      velocity: hit.velocity,
      ...(hit.hand === undefined ? {} : { hand: hit.hand }),
      ...(hit.loudness === undefined ? {} : { loudness: hit.loudness }),
    }));
}

/** What a lap holds, as far into it as a short one goes. */
function cutTo(content: readonly InALap[], lengthMs: number): readonly InALap[] {
  return content
    .filter((hit) => hit.afterMs < lengthMs - SAME_MOMENT_MS)
    .map((hit) => ({ ...hit, lengthMs: Math.min(hit.lengthMs, lengthMs - hit.afterMs) }));
}

/** What a lap holds, said so that two laps holding the same say the same, in whole milliseconds. */
function said(content: readonly InALap[]): string {
  return content
    .map((hit) =>
      [
        Math.round(hit.afterMs),
        hit.midi,
        Math.round(hit.lengthMs),
        Math.round(hit.velocity * 127),
        hit.loudness === undefined ? '' : `${hit.loudness.level ?? ''}${String(hit.loudness.shade)}`,
      ].join(':'),
    )
    .sort()
    .join(' ');
}

/**
 * The drums with every hit begun in a loop - and as far as `clearUntilMs`,
 * where it was pulled in - taken out, and the laps written in their place
 * from what one holds.
 */
function theLapsWritten(
  events: readonly MidiFileEvent[],
  loop: DrumLoop,
  source: readonly InALap[],
  clearUntilMs: number,
): readonly MidiFileEvent[] {
  const gone = new Set<number>();
  for (const hit of theHitsOf(events)) {
    if (hit.atMs >= loop.fromMs - SAME_MOMENT_MS && hit.atMs < clearUntilMs - SAME_MOMENT_MS) {
      gone.add(hit.on);
      if (hit.off !== null) {
        gone.add(hit.off);
      }
    }
  }
  const written = theLapsOf(loop).flatMap((lap) =>
    cutTo(source, lap.untilMs - lap.fromMs).flatMap((hit): MidiFileEvent[] => {
      const atMs = lap.fromMs + hit.afterMs;
      return [
        {
          kind: 'drumOn',
          atMs,
          midi: hit.midi,
          velocity: hit.velocity,
          ...(hit.hand === undefined ? {} : { hand: hit.hand }),
          ...(hit.loudness === undefined ? {} : { loudness: hit.loudness }),
        },
        { kind: 'drumOff', atMs: atMs + hit.lengthMs, midi: hit.midi },
      ];
    }),
  );
  return inTheOrderPlayed([...events.filter((_, at) => !gone.has(at)), ...written]);
}
