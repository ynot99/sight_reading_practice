import type { NoteVerdict } from '../../domain/matching/ChordMatcher.js';
import type { MidiFileEvent } from '../../domain/midi/MidiFile.js';
import type { BeatWeight, MetronomeTick } from '../ports/IMetronome.js';
import type {
  MidiNoteOffEvent,
  MidiNoteOnEvent,
  MidiPedalEvent,
} from '../ports/IMidiSource.js';
import type { NoteJudgedEvent } from './SessionEvents.js';

/**
 * One key going down and coming up again, as it was actually played.
 *
 * Times are on the clock the events arrived on, untouched. Nothing here is
 * rebased against where the music starts, and deliberately: the bar frame
 * moves the run's origin at every gate it opens, so an origin subtracted at
 * capture time would be a different number for the beginning of a run than for
 * the end of it, and the picture would bend where the reader waited. The view
 * subtracts one origin from the finished roll, which is one arithmetic and
 * cannot disagree with itself.
 */
export interface RolledPress {
  readonly midi: number;
  readonly downAtMs: number;
  /** `null` where the key was still down when the run ended. */
  readonly upAtMs: number | null;
  /** `0..1`, as the keyboard sent it. */
  readonly velocity: number;
  /**
   * What the run made of the press, or `null` for one it never judged.
   *
   * A press can go unjudged: struck while the music was somewhere else, or
   * after the step it was reaching for had already closed. Drawn without a
   * verdict it is still worth seeing - it is a key the reader pressed - and
   * saying `null` is how the picture admits that nothing was decided about it
   * rather than quietly calling it wrong.
   */
  readonly verdict: NoteVerdict | null;
  readonly stepIndex: number | null;
  /** How far from the beat, where the mode judges timing at all. */
  readonly deviationMs: number | null;
}

/** One click of the pulse, at the moment it was heard. */
export interface RolledBeat {
  readonly atMs: number;
  readonly weight: BeatWeight;
  /**
   * Where in the music it fell, in divisions from the start of the piece.
   *
   * The music's position, never the metronome's own bar count. A frame with a
   * gate at every bar line begins its pulse again each time one opens, and a
   * pulse begun again counts its bars from nought - so the counter runs 1, 0,
   * 0, 0, 1, 0 through a piece and is no use for naming anything. The music's
   * position is the one number that keeps meaning the same thing, and a bar
   * name is read off it.
   *
   * It is also what tells the two beats of a bar line apart. The tick where the
   * gate closed and the first tick of the pulse the reader's press restarted
   * are both that bar's downbeat and both recorded, at two different moments -
   * where it fell due, and where it was given. They carry the same position,
   * which is how the drawing knows to say so.
   */
  readonly positionTicks: number;
}

/** A click, and whether it is a beat the reader gave rather than one that fell. */
export interface MarkedBeat extends RolledBeat {
  /**
   * A second beat at a position already marked, which is the reader giving a
   * bar line its downbeat after it fell due.
   *
   * The gap between the two is the wait, which is the thing worth seeing: his
   * "коли є подвійні сильні долі - то мої ноти натиснуті не дуже рівно
   * співпадають з правильною сильною долею".
   */
  readonly given: boolean;
  /** How long after it fell due it was given, or `null` where it fell. */
  readonly lateByMs: number | null;
}

/** The sustain pedal down and up again. */
export interface RolledPedal {
  readonly downAtMs: number;
  /** `null` where it was still down when the run ended. */
  readonly upAtMs: number | null;
}

/**
 * Everything a run did, in the order it happened, for drawing rather than for
 * scoring.
 *
 * The report says how it went; this says what happened. They are built from
 * the same stream and answer different questions: a mean deviation of forty
 * milliseconds cannot say whether the reader is evenly late, accelerating
 * through the phrase, or steady in one hand and dragging in the other, and
 * those are three different things to practise.
 */
export interface RunRoll {
  readonly presses: readonly RolledPress[];
  readonly beats: readonly RolledBeat[];
  readonly pedal: readonly RolledPedal[];
  /**
   * Whether anything was left out for want of room.
   *
   * A run is bounded by the piece and cannot realistically reach these caps,
   * but a run left going all afternoon would, and a measuring tool that
   * quietly discards half its measurements is worse than one that says so.
   */
  readonly truncated: boolean;
}

/**
 * How long a roll goes on past its last event.
 *
 * Air at the end of the picture, and the length of a note nobody heard the end
 * of. One second, which is long enough to see and to hear.
 */
const ROLL_TAIL_MS = 1_000;

/**
 * How fine a grid is asked for.
 *
 * Two questions, because they are two: whether the beats between the bar lines
 * are drawn at all, and how many parts each beat is cut into.
 *
 * The cutting is *asked for* rather than read off the run, which is the whole
 * change here. Drawing every tick the pulse happened to give was
 * unpredictable - as fine as the shortest note in the piece, which on his
 * material is sixteenths - so it put sixteen lines in every bar and made the
 * click a rattle: "ця опція малює дуже багато смужок, та метроном поводить себе
 * як шалений коли я включаю це. Чому не можна мати опції з кастомними смужками
 * між вже існуючими?". Cut into two, three or four, a grid is what the reader
 * chose and a click is what a metronome has always offered.
 *
 * Asked of the drawing and of the clicks together, because a line the eye can
 * see and a click the ear can hear have to be the same grid or neither is
 * worth anything.
 */
export interface GridChoice {
  /** Whether the beats inside a bar are drawn, or only the bar lines. */
  readonly beats: boolean;
  /** How many parts each beat is cut into. One leaves it whole. */
  readonly parts: number;
}

/** Bars and beats, each beat whole, which is what a reader counts. */
export const PLAIN_GRID: GridChoice = { beats: true, parts: 1 };

/** A line of the grid, whether the pulse gave it or it was worked out. */
export interface GridLine {
  readonly atMs: number;
  readonly weight: BeatWeight;
  readonly given: boolean;
  readonly lateByMs: number | null;
  /**
   * Where in the music it falls, or `null` for a line cut between two beats.
   *
   * Cut lines have no place of their own in the score: they are a share of the
   * time between two clicks, which is all anybody wants of them.
   */
  readonly positionTicks: number | null;
}

/** Presses kept before a run stops recording them. */
const PRESS_CAPACITY = 20_000;
/** And clicks, which at the finest resolution outnumber the presses. */
const BEAT_CAPACITY = 60_000;

const EMPTY: RunRoll = { presses: [], beats: [], pedal: [], truncated: false };

/** A press whose verdict has not arrived yet, and where it sits. */
interface Open {
  readonly midi: number;
  readonly at: number;
}

/**
 * Writes down a run as it is played.
 *
 * Fed rather than subscribed: the session already receives every press, every
 * release and every click, and a second subscription to the same keyboard
 * would have to pair each press with its verdict across two streams that can
 * interleave. Told directly, the pairing is whatever the session did.
 */
export class RollRecorder {
  private presses: RolledPress[] = [];
  private beats: RolledBeat[] = [];
  private pedalSpans: RolledPedal[] = [];
  /** Keys still down, oldest first, by the press each one belongs to. */
  private readonly held: Open[] = [];
  /** Presses still waiting for a verdict, oldest first. */
  private readonly unjudged: Open[] = [];
  private pedalDownAt: number | null = null;
  private full = false;

  /** Forgets the last run. Called where a run begins, not where one ends. */
  reset(): void {
    this.presses = [];
    this.beats = [];
    this.pedalSpans = [];
    this.held.length = 0;
    this.unjudged.length = 0;
    this.pedalDownAt = null;
    this.full = false;
  }

  keyDown(event: MidiNoteOnEvent): void {
    if (this.presses.length >= PRESS_CAPACITY) {
      this.full = true;
      return;
    }
    const at = this.presses.length;
    this.presses.push({
      midi: event.midi,
      downAtMs: event.timestampMs,
      upAtMs: null,
      velocity: event.velocity,
      verdict: null,
      stepIndex: null,
      deviationMs: null,
    });
    this.held.push({ midi: event.midi, at });
    this.unjudged.push({ midi: event.midi, at });
  }

  keyUp(event: MidiNoteOffEvent): void {
    // The oldest press of that key still down, because that is the one being
    // let go of. A trill holds the same pitch twice within a few hundred
    // milliseconds, and closing the newest would leave the first note of it
    // running to the end of the piece.
    const index = this.held.findIndex((open) => open.midi === event.midi);
    if (index < 0) {
      return;
    }
    const [open] = this.held.splice(index, 1);
    const press = open === undefined ? undefined : this.presses[open.at];
    if (open === undefined || press === undefined) {
      return;
    }
    this.presses[open.at] = { ...press, upAtMs: event.timestampMs };
  }

  /**
   * Attaches a verdict to the press it was given for.
   *
   * The oldest unjudged press of that pitch, for the same reason a release
   * takes the oldest held one - and because a verdict can arrive long after
   * the press. A note struck before the music reached it is held and judged
   * when the gate it was reaching for opens, so by then the reader may have
   * struck the same key again.
   */
  judged(event: NoteJudgedEvent): void {
    const index = this.unjudged.findIndex((open) => open.midi === event.midi);
    if (index < 0) {
      return;
    }
    const [open] = this.unjudged.splice(index, 1);
    const press = open === undefined ? undefined : this.presses[open.at];
    if (open === undefined || press === undefined) {
      return;
    }
    this.presses[open.at] = {
      ...press,
      verdict: event.verdict,
      stepIndex: event.stepIndex,
      deviationMs: event.deviationMs,
    };
  }

  pedal(event: MidiPedalEvent): void {
    if (event.down) {
      // Already down stays down: a keyboard sends a stream of values while the
      // pedal moves, and half-pedalling is a dozen of them. One span.
      this.pedalDownAt ??= event.timestampMs;
      return;
    }
    if (this.pedalDownAt === null) {
      return;
    }
    this.pedalSpans.push({ downAtMs: this.pedalDownAt, upAtMs: event.timestampMs });
    this.pedalDownAt = null;
  }

  /**
   * One click, at the moment it is heard rather than the moment it is placed.
   *
   * @param positionTicks Where in the music it fell, which the caller knows and
   * the tick does not: a tick counts from wherever its pulse began.
   */
  beat(tick: MetronomeTick, positionTicks: number): void {
    if (this.beats.length >= BEAT_CAPACITY) {
      this.full = true;
      return;
    }
    this.beats.push({
      atMs: tick.scheduledTimeMs,
      weight: tick.isDownbeat ? 'downbeat' : tick.isPulse ? 'beat' : 'division',
      positionTicks,
    });
  }

  /**
   * The run as it stands, with whatever is still down left open.
   *
   * A key held when the run ends has no release to draw to, and inventing one
   * at the run's end would say the reader let go there. `null` says they had
   * not, and the view runs the note to the edge of what it is drawing.
   */
  roll(): RunRoll {
    const pedal =
      this.pedalDownAt === null
        ? this.pedalSpans
        : [...this.pedalSpans, { downAtMs: this.pedalDownAt, upAtMs: null }];
    return {
      presses: [...this.presses],
      beats: [...this.beats],
      pedal: [...pedal],
      truncated: this.full,
    };
  }
}

/** A roll with nothing in it, for a run that has not been played. */
export function emptyRoll(): RunRoll {
  return EMPTY;
}

/**
 * Where the roll's nought is: the first thing that happened, whatever it was.
 *
 * Asked here rather than worked out by whoever needs it, because two answers
 * would be two pictures. The drawing places every note against this, and so
 * does the head that says where a playback has got to - a head that measured
 * from a different nought would drift across the notes it is meant to be
 * walking over.
 */
export function rollBeganAtMs(roll: RunRoll): number {
  const first = [
    ...roll.beats.map((beat) => beat.atMs),
    ...roll.presses.map((press) => press.downAtMs),
    ...roll.pedal.map((span) => span.downAtMs),
  ];
  return first.length === 0 ? 0 : Math.min(...first);
}

/**
 * And where it stops: a moment after the last thing that happened.
 *
 * The moment is not decoration. A key still down when the run ended has no
 * release to be drawn or sounded to, and this is where it gets one - so the
 * drawing gives it a width and the playback gives it a length, from the same
 * number. Asked separately, the two disagreed: the picture held such a note
 * for a second and the playback for nothing at all, which in a mode with no
 * pulse at all - where a roll is presses and nothing else - made the whole
 * performance silent.
 */
export function rollEndedAtMs(roll: RunRoll): number {
  const last = [
    ...roll.beats.map((beat) => beat.atMs),
    ...roll.presses.map((press) => press.upAtMs ?? press.downAtMs),
    ...roll.pedal.map((span) => span.upAtMs ?? span.downAtMs),
  ];
  const began = rollBeganAtMs(roll);
  return (last.length === 0 ? began : Math.max(...last)) + ROLL_TAIL_MS;
}

/**
 * The clicks worth marking: the bar lines and the beats, never what falls
 * between them.
 *
 * One answer, asked by the drawing for its lines and by a playback for its
 * clicks, so the eye and the ear cannot disagree about where the beat was. A
 * pulse may be running at four ticks to the beat for the sake of the practice
 * loop's resolution, and all four drawn is a grey wash while all four sounded
 * is a rattle - in both cases the beat stops being visible in it.
 *
 * What it cannot claim to be is what the reader *heard*: whether a click
 * sounded during the run depended on the dropout and the mute, and the roll
 * keeps the pulse rather than the volume. This is the beat the music was
 * measured against, which is the question being asked of it afterwards.
 */
export function beatsWorthMarking(roll: RunRoll, everyTick = false): readonly MarkedBeat[] {
  const marking = everyTick
    ? [...roll.beats]
    : roll.beats.filter((beat) => beat.weight !== 'division');
  return marking.map((beat, index) => {
    // The beat before it at the same place in the music, if there is one. Only
    // ever the one before: a bar line is given once.
    const fell = index > 0 ? marking[index - 1] : undefined;
    const given = fell !== undefined && fell.positionTicks === beat.positionTicks;
    return {
      ...beat,
      given,
      lateByMs: given && fell !== undefined ? beat.atMs - fell.atMs : null,
    };
  });
}

/**
 * Every place in the music a click marked, with the two moments it may have.
 *
 * A bar line that waited has both: when it fell, and when the reader took it.
 * Ordered, one entry per place.
 */
function placesMarked(
  roll: RunRoll,
): readonly { readonly ticks: number; readonly fell: number; readonly taken: number }[] {
  const places = new Map<number, { ticks: number; fell: number; taken: number }>();
  for (const beat of beatsWorthMarking(roll)) {
    const seen = places.get(beat.positionTicks);
    if (seen === undefined) {
      places.set(beat.positionTicks, {
        ticks: beat.positionTicks,
        fell: beat.atMs,
        taken: beat.atMs,
      });
      continue;
    }
    seen.taken = beat.atMs;
  }
  return [...places.values()].sort((left, right) => left.ticks - right.ticks);
}

/**
 * The grid: the clicks that marked the music, and the lines cut between them.
 *
 * A cut line is a share of the time that really elapsed between two beats,
 * which runs from where the first was *taken* to where the second *fell* - so
 * nothing is ever cut inside a wait. A quarter-beat line drawn in the middle of
 * a bar line's waiting would be a beat that never existed.
 */
export function theGrid(roll: RunRoll, choice: GridChoice = PLAIN_GRID): readonly GridLine[] {
  const lines: GridLine[] = beatsWorthMarking(roll)
    // A bar line the reader gave late is a downbeat, so it survives the
    // coarsest reading: there, that pair is half of what there is to see.
    .filter((beat) => choice.beats || beat.weight === 'downbeat')
    .map((beat) => ({ ...beat }));
  const parts = Math.max(1, Math.round(choice.parts));
  if (parts > 1) {
    const places = placesMarked(roll);
    for (let index = 0; index + 1 < places.length; index += 1) {
      const from = places[index];
      const to = places[index + 1];
      if (from === undefined || to === undefined) {
        continue;
      }
      for (let part = 1; part < parts; part += 1) {
        lines.push({
          atMs: from.taken + ((to.fell - from.taken) * part) / parts,
          weight: 'division',
          given: false,
          lateByMs: null,
          positionTicks: null,
        });
      }
    }
  }
  return lines.sort((left, right) => left.atMs - right.atMs);
}

/**
 * The grid without the reader's own giving of a bar line.
 *
 * Two questions turn out to be this one. What a playback clicks: they played
 * that bar line and heard it on their own instrument, so a second click there
 * is the machine agreeing with them rather than keeping time for them. And what
 * a tap on the drawing lands on: the beat is the thing worth pointing at, and
 * the beat the reader was late for is where they meant to point.
 */
export function theMusicsBeats(
  roll: RunRoll,
  choice: GridChoice = PLAIN_GRID,
): readonly GridLine[] {
  return theGrid(roll, choice).filter((line) => !line.given);
}

/**
 * The beat nearest a moment, in milliseconds from the roll's beginning.
 *
 * So that a tap lands on the grid rather than between its lines. A finger is
 * worth about a tenth of a second at any readable zoom, and nobody pointing at
 * a run means "thirty-eight milliseconds after the third beat" - they mean the
 * beat. Ties go to the earlier one, which is the beat already begun.
 *
 * The moment itself where the music has no beats at all. In a frame that waits
 * for the reader there is no pulse to snap to, and moving the head somewhere
 * they did not point would be worse than not snapping.
 */
export function theBeatNearest(
  roll: RunRoll,
  atMs: number,
  choice: GridChoice = PLAIN_GRID,
): number {
  const began = rollBeganAtMs(roll);
  let nearest: number | null = null;
  // Whatever is drawn is what a tap lands on: snapping to a line the reader
  // cannot see would move the head somewhere they had no way to mean.
  for (const beat of theMusicsBeats(roll, choice)) {
    const at = beat.atMs - began;
    if (nearest === null || Math.abs(at - atMs) < Math.abs(nearest - atMs)) {
      nearest = at;
    }
  }
  return nearest ?? atMs;
}

/**
 * The clicks falling due in the stretch of a playback about to be heard.
 *
 * Handed over in windows, the way the notes are: a click has to be placed on
 * the audio graph before it sounds, and the whole run's worth laid out at once
 * could not be taken back when the reader stops.
 *
 * @param from How many have already been handed over.
 * @param untilMs How far into the roll the window reaches, from its beginning.
 */
export function clicksUpTo(
  roll: RunRoll,
  from: number,
  untilMs: number,
  choice: GridChoice = PLAIN_GRID,
): readonly GridLine[] {
  const marking = theMusicsBeats(roll, choice);
  const began = rollBeganAtMs(roll);
  const due: GridLine[] = [];
  for (let index = Math.max(0, from); index < marking.length; index += 1) {
    const beat = marking[index];
    if (beat === undefined || beat.atMs - began > untilMs) {
      break;
    }
    due.push(beat);
  }
  return due;
}

/**
 * How many clicks fall *before* a moment, and so are behind a playback started
 * there.
 *
 * Its own function rather than `clicksUpTo` read backwards, because the two
 * questions disagree exactly on the boundary and the boundary is the whole of
 * it. What to hand over next includes the click due at this instant; what is
 * already spent does not - counted the other way, a playback from the beginning
 * spent the downbeat before sounding it, and a tap on a bar line lost that
 * bar's click.
 */
export function clicksBefore(
  roll: RunRoll,
  atMs: number,
  choice: GridChoice = PLAIN_GRID,
): number {
  const began = rollBeganAtMs(roll);
  return theMusicsBeats(roll, choice).filter((beat) => beat.atMs - began < atMs).length;
}

/**
 * Which side of a place in the music is being asked about.
 *
 * A bar line the reader gave late has two moments, and which one is wanted
 * depends on the direction: something *beginning* there began when they gave it,
 * and something *ending* there was over when the beat fell due. Asked one way
 * for both, a note ending on the bar line was drawn on to the end of the wait -
 * his: "ghost нота не обрізається на жовтій секції... буде продовжена до кінця
 * жовтої секції".
 */
export type MusicalEdge = 'starts' | 'ends';

/**
 * When a place in the music happened, in milliseconds from the roll's start.
 *
 * The whole difficulty of drawing what *should* have been played: the notes are
 * written in divisions and the picture is in real time, and no tempo can join
 * the two - where a bar line waited for the reader, time did not pass at the
 * rate the score says.
 *
 * So it is read off the clicks that actually happened. Between two places, the
 * stretch that really elapsed runs from where the earlier one was *taken* to
 * where the later one *fell*: the waiting at the far end is not part of the
 * music between them.
 *
 * `null` when there is no pair to measure between, which is a frame that ran no
 * pulse: nothing there to place anything against.
 */
export function momentOfTicks(
  roll: RunRoll,
  positionTicks: number,
  edge: MusicalEdge = 'starts',
): number | null {
  const began = rollBeganAtMs(roll);
  // Two moments per place: when the beat fell, and when the reader took it.
  // They differ only at a bar line that waited, and that is the whole point.
  const fell = new Map<number, number>();
  const taken = new Map<number, number>();
  for (const beat of beatsWorthMarking(roll, true)) {
    const at = beat.atMs - began;
    if (!fell.has(beat.positionTicks)) {
      fell.set(beat.positionTicks, at);
    }
    taken.set(beat.positionTicks, at);
  }
  const places = [...fell.keys()].sort((left, right) => left - right);
  const exactly = edge === 'ends' ? fell.get(positionTicks) : taken.get(positionTicks);
  if (exactly !== undefined) {
    return exactly;
  }
  // The pair to measure between: the one the position falls inside, or the
  // nearest pair at whichever end it lies beyond.
  let index = places.findIndex((place) => place > positionTicks) - 1;
  if (index < 0) {
    index = positionTicks <= (places[0] ?? 0) ? 0 : places.length - 2;
  }
  const from = places[index];
  const to = places[index + 1];
  // Which is also how a run with fewer than two clicks answers: there is no
  // pair, so there is nothing to measure between and nothing to say.
  if (from === undefined || to === undefined || to === from) {
    return null;
  }
  const atFrom = taken.get(from) ?? 0;
  const atTo = fell.get(to) ?? 0;
  return atFrom + ((positionTicks - from) * (atTo - atFrom)) / (to - from);
}

/**
 * The run as a stream something can play.
 *
 * So that hearing a run back is the machinery that already plays a recording
 * rather than a second one: `TakePlayer` takes exactly this, pedal included.
 * Rebased to the roll's own nought, which is also the drawing's - so the note
 * that sounds is the note under the head.
 *
 * A key still down at the end is let go of there. It has to be let go of
 * somewhere, and the alternative is a note that sounds for ever.
 */
export function rollAsEvents(roll: RunRoll): readonly MidiFileEvent[] {
  const origin = rollBeganAtMs(roll);
  const ends = rollEndedAtMs(roll);
  const events: MidiFileEvent[] = [];
  for (const press of roll.presses) {
    events.push({
      kind: 'noteOn',
      atMs: press.downAtMs - origin,
      midi: press.midi,
      velocity: press.velocity,
    });
    events.push({ kind: 'noteOff', atMs: (press.upAtMs ?? ends) - origin, midi: press.midi });
  }
  for (const span of roll.pedal) {
    events.push({ kind: 'sustain', atMs: span.downAtMs - origin, value: 1 });
    events.push({ kind: 'sustain', atMs: (span.upAtMs ?? ends) - origin, value: 0 });
  }
  return events.sort((left, right) => left.atMs - right.atMs);
}
