import type { NoteVerdict } from '../../domain/matching/ChordMatcher.js';
import {
  damperIsDown,
  inTheOrderPlayed,
  theClickOfTheTake,
  theLevelOfTheNote,
  type Hand,
  type MidiFileEvent,
  type NoteLoudness,
} from '../../domain/midi/MidiFile.js';
import { Duration } from '../../domain/model/Duration.js';
import {
  barLines,
  DYNAMIC_LEVELS,
  elapsedMsAt,
  pedalSpans,
  velocityAt,
  type DynamicLevel,
  type Exercise,
} from '../../domain/model/Exercise.js';
import { notesStruckAt, soundsFor, type ExerciseTimeline } from '../../domain/timeline/Timeline.js';
import { createRng } from '../../domain/generation/Rng.js';
import { isAScale, type ScaleName } from '../../domain/harmony/scales.js';
import type { BeatWeight } from '../ports/IMetronome.js';
import type {
  MidiNoteOffEvent,
  MidiNoteOnEvent,
  MidiPedalEvent,
} from '../ports/IMidiSource.js';
import type { NoteJudgedEvent } from './SessionEvents.js';
import type { Take } from '../PerformanceRecorder.js';

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
  /** Which hand plays it, where that has been said: a sketch's notes may say. */
  readonly hand?: Hand;
  /**
   * The level it is written at, where it is written at one - its own, or the
   * dynamic marked over it - rather than as loud as it was struck.
   */
  readonly written?: { readonly level: DynamicLevel; readonly own: boolean };
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

/** A stretch the music stood still in, waiting for the reader. */
export interface RolledWait {
  readonly fromMs: number;
  readonly untilMs: number;
}

/**
 * The reader arriving somewhere before the music had got there.
 *
 * Its own record, where a wait is read off a pair of beats, and the asymmetry is
 * real rather than untidy. Waiting leaves two beats at one place - where it fell
 * and where the reader gave it - because the music was still there to be given.
 * Arriving early leaves one: the music moved on when they played, so the beat
 * they overtook never happened and is not written down, and there is no second
 * moment to measure against. It also has no width, which is why it is drawn as a
 * line and a wait as a section.
 *
 * Carried here rather than on the beat the reader placed, because that beat is
 * not always one the grid draws - an entry between the clicks they chose is a
 * division, and divisions are filtered out of the grid so that clicking them is
 * not a rattle. Ridden on the beat, an early entry between the clicks left no
 * mark at all, which is the same fault the sections had.
 */
export interface RolledRush {
  /** When the reader arrived. */
  readonly atMs: number;
  /** How long before the music had it ready. */
  readonly byMs: number;
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
  /** Where the reader arrived before the music did; see {@link RolledRush}. */
  readonly rushes: readonly RolledRush[];
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

/**
 * Two moments this close together are the same moment, in milliseconds.
 *
 * Small enough that a beat and the reader giving it late are never confused -
 * that pair is a wait apart - and large enough to cover the one place two
 * accounts of the same beat arrive from different directions.
 */
export const ONE_BREATH_MS = 5;

/**
 * How long the music must stand still before that counts as standing still.
 *
 * Every entry in a frame that waits is later than the beat it answers by
 * *something*: the reader is a hand and not a clock. Drawn without a floor, the
 * first beat of every counted-in run came out with a section on it - the count
 * had just told him where the beat was, he arrived eighty milliseconds after it,
 * and the picture said the music had waited for him. His: "на початку гри є
 * якась дивна жовта секція, хоча звідки їй там взятись якщо це початок гри".
 *
 * Around a reader's own reaction, which is the line between "the music waited"
 * and "they are not a machine". The same argument the drawing already makes
 * about the gap between a note and its beat, which it refuses to colour below
 * twenty milliseconds for fear of becoming one continuous wash.
 */
export const A_WAIT_WORTH_DRAWING_MS = 150;

/** Presses kept before a run stops recording them. */
const PRESS_CAPACITY = 20_000;
/** And clicks, which at the finest resolution outnumber the presses. */
const BEAT_CAPACITY = 60_000;

const EMPTY: RunRoll = { presses: [], beats: [], pedal: [], rushes: [], truncated: false };

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
  private rushes: RolledRush[] = [];
  /** Keys still down, oldest first, by the press each one belongs to. */
  private readonly held: Open[] = [];
  /** Presses still waiting for a verdict, oldest first. */
  private readonly unjudged: Open[] = [];
  private pedalDownAt: number | null = null;
  private full = false;

  /**
   * Whether a beat of the music has already been written down at that moment.
   *
   * Same place in the music at the same instant is one beat recorded twice, not
   * two beats. Told apart from the pair a bar line really does have - where a
   * beat fell and where the reader gave it - by the moment: those are a wait
   * apart, and this is the same breath.
   */
  hasBeatAt(positionTicks: number, atMs: number): boolean {
    return this.beats.some(
      (beat) =>
        beat.positionTicks === positionTicks && Math.abs(beat.atMs - atMs) <= ONE_BREATH_MS,
    );
  }

  /** Forgets the last run. Called where a run begins, not where one ends. */
  reset(): void {
    this.presses = [];
    this.beats = [];
    this.pedalSpans = [];
    this.rushes = [];
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
   * The pedal was already down when the music began.
   *
   * A run does not start the reader's foot from nothing: it is put down and
   * then the first chord is played, which in the frame that begins a run *by*
   * playing that chord means the foot always moves before the run exists. The
   * lift, when it came, had no down to close and was dropped - so a pedal held
   * through a whole run was drawn as a pedal never touched at all. His: "якщо
   * я натискаю його рано, то воно показується що воно з самого початку взагалі
   * не було натиснуто".
   *
   * Opened where the music began rather than where the foot moved, because
   * that is what the picture is of. A moment spent settling in front of a run
   * belongs to no run's time, and dated truthfully it would hang seconds of
   * empty drawing in front of the first note to hold one band.
   *
   * Says nothing where a span is already open: told this twice - by a count-in
   * and then by a resume - it is still the one press.
   */
  pedalWasAlreadyDown(atMs: number): void {
    this.pedalDownAt ??= atMs;
  }

  /**
   * One click, at the moment it is heard rather than the moment it is placed.
   *
   * Told in these three terms rather than handed a tick, because not every beat
   * of a run comes from a pulse. A frame that waits for the reader runs none:
   * there the beat they come in on is theirs to place and the beats between
   * their entries are placed where they are written, and those are as much the
   * grid of that run as a pulse's ticks are of another's.
   */
  beat(atMs: number, weight: BeatWeight, positionTicks: number): void {
    if (this.beats.length >= BEAT_CAPACITY) {
      this.full = true;
      return;
    }
    this.beats.push({ atMs, weight, positionTicks });
  }

  /**
   * Writes down the reader arriving before the music did.
   *
   * Refused where it says nothing: an arrival at the moment the music was ready
   * is not early, and one the music had already passed is a wait.
   */
  rushed(atMs: number, byMs: number): void {
    if (byMs <= ONE_BREATH_MS || this.rushes.length >= BEAT_CAPACITY) {
      return;
    }
    this.rushes.push({ atMs, byMs });
  }

  /**
   * Takes back the beats from a moment onwards, they having been overtaken.
   *
   * A frame that waits lays the beats between two entries out ahead of the
   * reader, as far as the next note they owe. Come in early and the music moves
   * on from *there*, so the beats still standing in the stretch they left were
   * scheduled and never belonged to the run: drawn, they are lines at no
   * distance from each other in a grid that is meant to be even, which is the
   * greater part of what he was seeing. His: "просто придеться скіпати одразу
   * до наступної ноти яку я натиснув".
   */
  forgetBeatsFrom(atMs: number): void {
    // The moment itself survives: a beat scheduled for exactly the instant the
    // reader came in did sound, and the reader's own is refused separately if
    // it is the same beat twice.
    this.beats = this.beats.filter((beat) => beat.atMs <= atMs);
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
      rushes: [...this.rushes],
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
 * The line of the grid next to a moment, one way or the other: the first
 * after it, or the last before it - a moment on a line being on neither
 * side of it. What an arrow key steps a note to. `null` where there is none
 * that way. Moments as `theBeatNearest` has them, from the run's start.
 */
export function theNextLineOfTheGrid(
  roll: RunRoll,
  atMs: number,
  choice: GridChoice,
  way: 1 | -1,
): number | null {
  const began = rollBeganAtMs(roll);
  // Half a millisecond either way: a note put on a line is put there in whole
  // milliseconds, and a line may fall between two.
  const lines = theMusicsBeats(roll, choice).map((line) => line.atMs - began);
  const beyond = way === 1 ? lines.filter((at) => at > atMs + 0.5) : lines.filter((at) => at < atMs - 0.5);
  return beyond.length === 0 ? null : way === 1 ? Math.min(...beyond) : Math.max(...beyond);
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
  return theMomentsOfTicks(roll)(positionTicks, edge);
}

/**
 * `momentOfTicks` for many places of one roll: the clicks read once, and
 * each place found among them by halving. Asked afresh for each note, a
 * score of thousands of notes read its hundreds of clicks thousands of
 * times over, and choosing notes on its drawing, which draws it again,
 * took seconds.
 */
export function theMomentsOfTicks(roll: RunRoll): (positionTicks: number, edge?: MusicalEdge) => number | null {
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
  return (positionTicks, edge = 'starts') => {
    const exactly = edge === 'ends' ? fell.get(positionTicks) : taken.get(positionTicks);
    if (exactly !== undefined) {
      return exactly;
    }
    // The pair to measure between: the one the position falls inside, or the
    // nearest pair at whichever end it lies beyond.
    const firstPast = theFirstPast(places, positionTicks);
    let index = firstPast - 1;
    if (index < 0 || firstPast === places.length) {
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
  };
}

/** Where the first of some places in order lies past a position, or how many there are where none does. */
function theFirstPast(places: readonly number[], positionTicks: number): number {
  let low = 0;
  let high = places.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((places[middle] ?? 0) > positionTicks) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

/**
 * Every stretch the music stood still in, however it came to be known.
 *
 * One answer to one question, and one shape of evidence for it: two beats at one
 * place in the music, where it fell and where the reader gave it. A gate at a bar
 * line leaves that pair, and so does every entry of a frame that waits on each
 * note - which is why the run writes a beat for an entry whatever the click has
 * to say about it.
 *
 * Every tick of them, and not the ones worth *drawing*. A beat too fine to be
 * given a line of its own is still a beat the reader came in on, and the music
 * stood still for it exactly as it does at a bar line. Read off the drawn ones,
 * a run clicking the divisions had a section on its downbeats and its beats and
 * none at all on anything between them - four of six entries, every one of them
 * the same distance late. His: "зі слабкими бітами я не дуже розумію... все одно
 * не бачу жовтих секцій для кожної ноти де я трішечки тормозив".
 */
export function theWaits(roll: RunRoll): readonly RolledWait[] {
  const found: RolledWait[] = [];
  for (const beat of beatsWorthMarking(roll, true)) {
    if (beat.lateByMs !== null && beat.lateByMs >= A_WAIT_WORTH_DRAWING_MS) {
      found.push({ fromMs: beat.atMs - beat.lateByMs, untilMs: beat.atMs });
    }
  }
  return found;
}

/**
 * Every place the reader arrived at before the music had got there.
 *
 * The other half of {@link theWaits} and deliberately not the same shape: this
 * one has no width, the stretch between where they played and where the beat was
 * due being time that never elapsed.
 */
export function theRushes(roll: RunRoll): readonly RolledRush[] {
  return roll.rushes;
}

/**
 * Where in the *music* the run had got to at that moment.
 *
 * A place in the picture is a time; a passage is a stretch of music. The beats
 * are the bridge between them, because each one carries the place it marks - so
 * the last beat at or before the moment says where the music stood.
 *
 * The last by *moment* rather than the last in the list: a bar line given late
 * is written down twice, where it fell due and where the reader gave it, and
 * those two arrive out of order.
 *
 * `null` where no beat had been written yet, which is a moment in front of the
 * music rather than in it.
 */
export function theMusicsPlaceAt(roll: RunRoll, atMs: number): number | null {
  let foundAt = Number.NEGATIVE_INFINITY;
  let found: number | null = null;
  for (const beat of roll.beats) {
    if (beat.atMs > atMs) {
      continue;
    }
    if (beat.atMs > foundAt || (beat.atMs === foundAt && beat.positionTicks > (found ?? 0))) {
      foundAt = beat.atMs;
      found = beat.positionTicks;
    }
  }
  return found;
}

/**
 * The run as something the list of recordings can hold, or `null`.
 *
 * `null` where nothing was played. A run is kept for what the reader did, and a
 * recording of no notes is the same nothing the foot on a pedal used to file -
 * so the rule is said once here and the two ways in agree.
 *
 * The events are the roll's own, rebased to its beginning, which is what makes
 * a kept run and a kept take the same kind of thing: one player, one file
 * format, one list.
 */
export function takeOfTheRun(roll: RunRoll): Take | null {
  const events = rollAsEvents(roll);
  const noteCount = events.filter((event) => event.kind === 'noteOn').length;
  if (noteCount === 0) {
    return null;
  }
  return {
    events,
    durationMs: Math.max(0, rollEndedAtMs(roll) - rollBeganAtMs(roll)),
    noteCount,
    // A run's bars are the score's, which is already written down.
    beats: [],
  };
}

/**
 * A recording, as something the picture can draw.
 *
 * The reverse of {@link takeOfTheRun}, and the reason a kept take can be looked
 * at rather than only heard: the drawing asks for presses and pedal spans, and
 * a recording is those written down as a stream.
 *
 * With no beats where it was played without the click, which is not an
 * omission. A run has a grid because something was keeping its time - a
 * pulse, or the reader's own entries against the page. Free playing alone has
 * neither, and lines drawn across it would be a metre nobody played claiming
 * to be the one that was. His: "for each recording add a button to add a MIDI
 * viewer, but without vertical lines to indicate the beat, because the beat
 * can be gibberish".
 *
 * Played to the click, it has the beats of the click as its file and its
 * page have them - from the first beat of the bar it began in, a crotchet
 * each - so the bars drawn are the bars written.
 *
 * A note still sounding at the end is left open, the same answer the roll gives
 * for a key still down when a run stops.
 */
export function rollOfTheTake(take: Pick<Take, 'events' | 'beats'>, beatsAfter = 0): RunRoll {
  const presses: RolledPress[] = theKeysOfTheTake(take.events).map((key) => ({
    midi: key.midi,
    downAtMs: key.downAtMs,
    upAtMs: key.upAtMs,
    velocity: key.velocity,
    verdict: null,
    stepIndex: null,
    deviationMs: null,
    ...(key.hand === undefined ? {} : { hand: key.hand }),
    ...(key.loudness === undefined
      ? {}
      : { written: { level: theLevelOfTheNote(take.events, key.downAtMs, key.loudness), own: key.loudness.level !== null } }),
  }));
  const pedal: RolledPedal[] = [];
  let pedalDownAt: number | null = null;
  for (const event of take.events) {
    if (event.kind !== 'sustain') {
      continue;
    }
    const down = event.value >= 0.5;
    if (down) {
      pedalDownAt ??= event.atMs;
      continue;
    }
    if (pedalDownAt !== null) {
      pedal.push({ downAtMs: pedalDownAt, upAtMs: event.atMs });
      pedalDownAt = null;
    }
  }
  if (pedalDownAt !== null) {
    pedal.push({ downAtMs: pedalDownAt, upAtMs: null });
  }
  // Each beat as long as its value, as the file has them.
  let positionTicks = 0;
  const beats: RolledBeat[] = (theClickOfTheTake(take.events, take.beats, beatsAfter) ?? []).map((beat) => {
    const placed: RolledBeat = { atMs: beat.atMs, weight: beat.beat === 0 ? 'downbeat' : 'beat', positionTicks };
    positionTicks += (Duration.QUARTER.ticks * 4) / (beat.beatType ?? 4);
    return placed;
  });
  return { presses, beats, pedal, rushes: [], truncated: false };
}

/** A key of a take, and where in its events it went down and came up, if it did. */
export interface KeyOfTheTake {
  readonly midi: number;
  readonly velocity: number;
  readonly hand?: Hand;
  readonly loudness?: NoteLoudness;
  readonly downAtMs: number;
  readonly upAtMs: number | null;
  readonly on: number;
  readonly off: number | null;
}

/**
 * Each key struck in a take, paired with the release that ends it: the
 * oldest press of that pitch still down, for the reason the recorder has -
 * one pitch struck twice inside a trill has two presses waiting, and closing
 * the newest leaves the first ringing to the end of the piece.
 *
 * One pairing for drawing a take and for changing it, so the note a finger
 * chooses on the drawing is the note taken out of the take.
 */
export function theKeysOfTheTake(events: readonly MidiFileEvent[]): readonly KeyOfTheTake[] {
  const keys: KeyOfTheTake[] = [];
  const open = new Map<number, number[]>();
  events.forEach((event, at) => {
    if (event.kind === 'noteOn') {
      open.set(event.midi, [...(open.get(event.midi) ?? []), keys.length]);
      keys.push({
        midi: event.midi,
        velocity: event.velocity,
        ...(event.hand === undefined ? {} : { hand: event.hand }),
        ...(event.loudness === undefined ? {} : { loudness: event.loudness }),
        downAtMs: event.atMs,
        upAtMs: null,
        on: at,
        off: null,
      });
    } else if (event.kind === 'noteOff') {
      const waiting = open.get(event.midi) ?? [];
      const index = waiting.shift();
      const key = index === undefined ? undefined : keys[index];
      if (index !== undefined && key !== undefined) {
        keys[index] = { ...key, upAtMs: event.atMs, off: at };
      }
    }
  });
  return keys;
}

/** A key of a take, named by its pitch and the moment it went down. */
export interface KeyNamed {
  readonly midi: number;
  readonly downAtMs: number;
}

/**
 * Where a key of a take is to be: struck at a moment as a pitch, and let go
 * of at another - or `null` to leave one still down at the end as it is -
 * and how hard, where that changes too.
 */
export interface KeyChange {
  readonly key: KeyNamed;
  readonly midi: number;
  readonly downAtMs: number;
  readonly upAtMs: number | null;
  readonly velocity?: number;
  /** The hand that plays it, `null` for whichever its pitch is in; left as it was where not said. */
  readonly hand?: Hand | null;
  /** How loud it is written, `null` for as loud as it is struck; left as it was where not said. */
  readonly loudness?: NoteLoudness | null;
}

/** Each named key's place in the take's pairing, or `null` where any is not there. */
function theKeysNamed(events: readonly MidiFileEvent[], named: readonly KeyNamed[]): KeyOfTheTake[] | null {
  const keys = theKeysOfTheTake(events);
  const found: KeyOfTheTake[] = [];
  for (const { midi, downAtMs } of named) {
    const key = keys.find((each) => each.midi === midi && each.downAtMs === downAtMs);
    if (key === undefined) {
      return null;
    }
    found.push(key);
  }
  return found;
}

/**
 * A take's events with keys taken out, each its press and its release; or
 * `null` where any is not there.
 */
export function takeWithoutTheKeys(
  events: readonly MidiFileEvent[],
  named: readonly KeyNamed[],
): readonly MidiFileEvent[] | null {
  const keys = theKeysNamed(events, named);
  if (keys === null) {
    return null;
  }
  const gone = new Set(keys.flatMap(({ on, off }) => (off === null ? [on] : [on, off])));
  return events.filter((_, at) => !gone.has(at));
}

/**
 * A take's events with keys changed all at once - moved, held longer or
 * shorter - and put in their places in time again; or `null` where any is
 * not there. At once, because the keys are found by where they are, and
 * changed one at a time the second would be looked for after the first had
 * moved.
 */
export function takeWithTheKeysChanged(
  events: readonly MidiFileEvent[],
  changes: readonly KeyChange[],
): readonly MidiFileEvent[] | null {
  const keys = theKeysNamed(
    events,
    changes.map((change) => change.key),
  );
  if (keys === null) {
    return null;
  }
  const changed = new Map<number, MidiFileEvent>();
  const added: MidiFileEvent[] = [];
  changes.forEach((change, at) => {
    const key = keys[at];
    const struck = key === undefined ? undefined : events[key.on];
    if (key === undefined || struck?.kind !== 'noteOn') {
      return;
    }
    const { hand: was, loudness: written, ...rest } = struck;
    const hand = change.hand === undefined ? was : (change.hand ?? undefined);
    const loudness = change.loudness === undefined ? written : (change.loudness ?? undefined);
    changed.set(key.on, {
      ...rest,
      atMs: change.downAtMs,
      midi: change.midi,
      velocity: change.velocity ?? struck.velocity,
      ...(hand === undefined ? {} : { hand }),
      ...(loudness === undefined ? {} : { loudness }),
    });
    if (change.upAtMs === null) {
      return;
    }
    const released: MidiFileEvent = { kind: 'noteOff', atMs: change.upAtMs, midi: change.midi };
    if (key.off === null) {
      added.push(released);
    } else {
      changed.set(key.off, released);
    }
  });
  return inTheOrderPlayed([...events.map((event, at) => changed.get(at) ?? event), ...added]);
}

/**
 * Where a key to be written of one pitch may end, so it neither begins on
 * nor sounds over another of that pitch: as late as asked, cut short where
 * the next of its pitch begins - or `null` where it would begin on or inside
 * one, or be cut to nothing. Two of one pitch at once are one key twice to a
 * file, whose second press nothing can let go of apart from the first, and
 * one this editor could not tell from the other.
 */
export function theEndAKeyFitsTo(
  events: readonly MidiFileEvent[],
  key: { readonly midi: number; readonly downAtMs: number; readonly upAtMs: number },
): number | null {
  let end = key.upAtMs;
  for (const other of theKeysOfTheTake(events)) {
    if (other.midi !== key.midi) {
      continue;
    }
    const otherEnd = other.upAtMs ?? Number.POSITIVE_INFINITY;
    if (other.downAtMs <= key.downAtMs && otherEnd > key.downAtMs) {
      return null;
    }
    if (other.downAtMs > key.downAtMs) {
      end = Math.min(end, other.downAtMs);
    }
  }
  return end > key.downAtMs ? end : null;
}

/**
 * Whether any of the keys named - where they now are, after a move or a
 * change of length - begins on or sounds over another key of its pitch
 * that is not one of them. Only those are asked of: a sketch may already
 * hold two of a pitch at once, read from a file, and that is no reason to
 * refuse a move elsewhere. The keys named keep their places among
 * themselves, and so cannot be over one another.
 */
export function aKeyIsOverAnotherOfItsPitch(events: readonly MidiFileEvent[], named: readonly KeyNamed[]): boolean {
  const keys = theKeysOfTheTake(events);
  const isNamed = (key: KeyOfTheTake): boolean =>
    named.some((each) => each.midi === key.midi && each.downAtMs === key.downAtMs);
  // Two keys answering to one name are one begun exactly on the other.
  const onAnother = named.some(
    (each) => keys.filter((key) => key.midi === each.midi && key.downAtMs === each.downAtMs).length > 1,
  );
  return onAnother || keys.some(
    (key) =>
      isNamed(key) &&
      keys.some(
        (other) =>
          other !== key &&
          !isNamed(other) &&
          other.midi === key.midi &&
          other.downAtMs < (key.upAtMs ?? Number.POSITIVE_INFINITY) &&
          key.downAtMs < (other.upAtMs ?? Number.POSITIVE_INFINITY),
      ),
  );
}

/**
 * How near a length has to come to a whole number of a grid's steps to be
 * taken for one, as a share of a step: a note played rather than written
 * is never exactly a quaver long, and one this far off is not meant as one.
 */
const A_STEP_FITS_WITHIN = 0.15;

/**
 * The grids finer than one, coarsest first: each step of it halved, cut in
 * three and cut in four - the beat cut so where the one chosen draws only
 * the bars.
 */
function theGridsFinerThan(choice: GridChoice): readonly GridChoice[] {
  const parts = Math.max(1, Math.round(choice.parts));
  return choice.beats
    ? [2, 3, 4].map((cut) => ({ beats: true, parts: parts * cut }))
    : [1, 2, 3, 4].map((cut) => ({ beats: true, parts: cut }));
}

/** The step of a grid a moment is in: from the line at or before it to the next; `null` where there is no next. */
function theStepOfTheGridAt(roll: RunRoll, atMs: number, choice: GridChoice): number | null {
  const next = theNextLineOfTheGrid(roll, atMs, choice, 1);
  return next === null ? null : next - theLineOfTheGridUnder(roll, atMs, choice);
}

/**
 * The grid a note is moved on: the one chosen, or where the note is shorter
 * than a step of it, the coarsest finer one its length is a whole number of
 * steps of - a quaver under a grid of beats moves by half beats, so it goes
 * before a beat as well as on one, and a triplet's note by thirds. One
 * shorter than a step that fits none, as a note played rather than written
 * often is, moves on the grid chosen.
 */
export function theGridForANote(roll: RunRoll, choice: GridChoice, atMs: number, lengthMs: number): GridChoice {
  const step = theStepOfTheGridAt(roll, atMs, choice);
  if (step === null || lengthMs >= step * (1 - A_STEP_FITS_WITHIN)) {
    return choice;
  }
  return (
    theGridsFinerThan(choice).find((finer) => {
      const finerStep = theStepOfTheGridAt(roll, atMs, finer);
      const steps = finerStep === null ? 0 : lengthMs / finerStep;
      return steps >= 1 - A_STEP_FITS_WITHIN && Math.abs(steps - Math.round(steps)) <= A_STEP_FITS_WITHIN;
    }) ?? choice
  );
}

/**
 * The lines a note's end may go to, from where it begins: those of the grid
 * after it, and inside the first step, the halves, thirds and quarters of
 * that step as well - so a note is made shorter than a step without a finer
 * grid being asked for. Moments from the run's start.
 */
function theLinesAnEndGoesTo(roll: RunRoll, choice: GridChoice, fromMs: number): readonly number[] {
  const began = rollBeganAtMs(roll);
  const next = theNextLineOfTheGrid(roll, fromMs, choice, 1);
  const lines = theMusicsBeats(roll, choice).map((line) => line.atMs - began);
  const finer = theGridsFinerThan(choice).flatMap((grid) => theMusicsBeats(roll, grid).map((line) => line.atMs - began));
  return [
    ...lines.filter((at) => at > fromMs + 0.5),
    ...(next === null ? [] : finer.filter((at) => at > fromMs + 0.5 && at < next - 0.5)),
  ];
}

/**
 * Where the end of a note begun at a moment goes, pulled to near another:
 * the nearest of `theLinesAnEndGoesTo`, or the moment itself where there
 * are none.
 */
export function theEndNearest(roll: RunRoll, choice: GridChoice, fromMs: number, wantedMs: number): number {
  return nearestOf(theLinesAnEndGoesTo(roll, choice, fromMs), wantedMs) ?? wantedMs;
}

/**
 * Where the start of a note let go of at a moment goes, pulled to near
 * another: the lines of the grid before its end, and inside the last step
 * before it, the halves, thirds and quarters of that step as well.
 */
export function theStartNearest(roll: RunRoll, choice: GridChoice, untilMs: number, wantedMs: number): number {
  const began = rollBeganAtMs(roll);
  const previous = theNextLineOfTheGrid(roll, untilMs, choice, -1);
  const lines = theMusicsBeats(roll, choice).map((line) => line.atMs - began);
  const finer = theGridsFinerThan(choice).flatMap((grid) => theMusicsBeats(roll, grid).map((line) => line.atMs - began));
  return (
    nearestOf(
      [
        ...lines.filter((at) => at < untilMs - 0.5),
        ...(previous === null ? [] : finer.filter((at) => at < untilMs - 0.5 && at > previous + 0.5)),
      ],
      wantedMs,
    ) ?? wantedMs
  );
}

/** The one of some moments nearest another, the earlier on a tie; `null` of none. */
function nearestOf(moments: readonly number[], wantedMs: number): number | null {
  let nearest: number | null = null;
  for (const at of [...moments].sort((one, other) => one - other)) {
    if (nearest === null || Math.abs(at - wantedMs) < Math.abs(nearest - wantedMs)) {
      nearest = at;
    }
  }
  return nearest;
}

/**
 * The line of the grid a moment is in the cell after: the last at or before
 * it - half a millisecond either side counting as on it - or the moment
 * itself where the grid has none so early. Where a note written there
 * begins, as the cell tapped in rather than the line nearest it, which for a
 * tap just before a note was that note's own beat.
 */
export function theLineOfTheGridUnder(roll: RunRoll, atMs: number, choice: GridChoice): number {
  return theNextLineOfTheGrid(roll, atMs + 1, choice, -1) ?? atMs;
}

/** Only the bar lines, which is what a slice is laid on. */
const BAR_LINES: GridChoice = { beats: false, parts: 1 };

/**
 * The stretch a slice laid between two moments takes in, in milliseconds
 * from the roll's beginning: whole bars, from the bar line at or before the
 * earlier to the one after the later - a moment on a bar line being in the
 * bar it begins. Before the first bar line it begins where they are, and
 * past the last it ends where the run does: a run with no bars at all is
 * sliced from the earlier moment to its end.
 */
export function theBarsAcross(roll: RunRoll, oneMs: number, otherMs: number): { readonly fromMs: number; readonly toMs: number } {
  const earlier = Math.min(oneMs, otherMs);
  const later = Math.max(oneMs, otherMs);
  return {
    fromMs: theLineOfTheGridUnder(roll, earlier, BAR_LINES),
    toMs: theNextLineOfTheGrid(roll, later, BAR_LINES, 1) ?? rollEndedAtMs(roll) - rollBeganAtMs(roll),
  };
}

/** A take's events with a key added, struck and let go of, in its place in time. */
export function takeWithAKeyAdded(
  events: readonly MidiFileEvent[],
  key: {
    readonly midi: number;
    readonly downAtMs: number;
    readonly upAtMs: number;
    readonly velocity: number;
    readonly loudness?: NoteLoudness;
  },
): readonly MidiFileEvent[] {
  return inTheOrderPlayed([
    ...events,
    {
      kind: 'noteOn',
      atMs: key.downAtMs,
      midi: key.midi,
      velocity: key.velocity,
      ...(key.loudness === undefined ? {} : { loudness: key.loudness }),
    },
    { kind: 'noteOff', atMs: key.upAtMs, midi: key.midi },
  ]);
}

/**
 * A take's events with a copy of each named key added beside it, moved by as
 * much in time and in pitch, as loud and in the same hand; or `null` where
 * any is not there. The keys copied stay where they are.
 */
export function takeWithTheKeysCopied(
  events: readonly MidiFileEvent[],
  named: readonly KeyNamed[],
  byMs: number,
  bySemitones: number,
): readonly MidiFileEvent[] | null {
  const keys = theKeysNamed(events, named);
  if (keys === null) {
    return null;
  }
  const copies = keys.flatMap((key): MidiFileEvent[] => {
    const struck = events[key.on];
    if (struck?.kind !== 'noteOn') {
      return [];
    }
    const midi = key.midi + bySemitones;
    const copy: MidiFileEvent = { ...struck, atMs: key.downAtMs + byMs, midi };
    return key.upAtMs === null ? [copy] : [copy, { kind: 'noteOff', atMs: key.upAtMs + byMs, midi }];
  });
  return inTheOrderPlayed([...events, ...copies]);
}

/**
 * A note of a sketch as it is copied: where it begins after the first of those
 * copied begins, how long it is held, its pitch, how hard and in which hand.
 * Counted from the first, so pasted they begin wherever they are put.
 */
export interface NoteCopied {
  readonly afterMs: number;
  readonly lengthMs: number;
  readonly midi: number;
  readonly velocity: number;
  readonly hand?: Hand;
  readonly loudness?: NoteLoudness;
}

/**
 * What notes copied are called on the clipboard, so a paste can tell them
 * from any other text there.
 */
const NOTES_ON_THE_CLIPBOARD = 'sight-reading-practice/notes';

/**
 * The named keys of a take as they are copied, earliest first. A key still
 * down at the end has no length to be copied with, and is left out.
 */
export function theNotesCopied(events: readonly MidiFileEvent[], named: readonly KeyNamed[]): readonly NoteCopied[] {
  const keys = theKeysOfTheTake(events).filter(
    (key) => key.upAtMs !== null && named.some((each) => each.midi === key.midi && each.downAtMs === key.downAtMs),
  );
  const first = Math.min(...keys.map((key) => key.downAtMs));
  return [...keys]
    .sort((one, other) => one.downAtMs - other.downAtMs || one.midi - other.midi)
    .map((key) => ({
      afterMs: key.downAtMs - first,
      lengthMs: (key.upAtMs ?? key.downAtMs) - key.downAtMs,
      midi: key.midi,
      velocity: key.velocity,
      ...(key.hand === undefined ? {} : { hand: key.hand }),
      ...(key.loudness === undefined ? {} : { loudness: key.loudness }),
    }));
}

/** Notes copied as the text the clipboard holds. */
export function theClipboardTextOf(notes: readonly NoteCopied[]): string {
  return JSON.stringify({ copied: NOTES_ON_THE_CLIPBOARD, notes });
}

/**
 * The notes a clipboard's text holds, or `null` where it holds anything
 * else. The text may have come from anywhere, so every note is asked of, and
 * one that is not a note refuses the whole: half a figure pasted is a wrong
 * one.
 */
export function theNotesOnTheClipboard(text: string): readonly NoteCopied[] | null {
  let read: unknown;
  try {
    read = JSON.parse(text);
  } catch {
    return null;
  }
  const said = read as { readonly copied?: unknown; readonly notes?: unknown } | null;
  if (typeof said !== 'object' || said === null || said.copied !== NOTES_ON_THE_CLIPBOARD || !Array.isArray(said.notes)) {
    return null;
  }
  // JSON reads a number too large for a double as an endless one.
  const isANumber = (value: unknown): value is number => Number.isFinite(value);
  const isAWholeNumber = (value: unknown): value is number => Number.isInteger(value);
  const notes: NoteCopied[] = [];
  for (const each of said.notes as readonly unknown[]) {
    const note = each as Partial<Record<keyof NoteCopied, unknown>> | null;
    if (
      note === null ||
      !isANumber(note.afterMs) ||
      note.afterMs < 0 ||
      !isANumber(note.lengthMs) ||
      note.lengthMs <= 0 ||
      !isAWholeNumber(note.midi) ||
      note.midi < 0 ||
      note.midi > 127 ||
      !isANumber(note.velocity) ||
      !(note.velocity > 0 && note.velocity <= 1) ||
      !(note.hand === undefined || note.hand === 'left' || note.hand === 'right') ||
      !(note.loudness === undefined || isALoudness(note.loudness))
    ) {
      return null;
    }
    notes.push({
      afterMs: note.afterMs,
      lengthMs: note.lengthMs,
      midi: note.midi,
      velocity: note.velocity,
      ...(note.hand === undefined ? {} : { hand: note.hand }),
      ...(note.loudness === undefined ? {} : { loudness: note.loudness }),
    });
  }
  return notes.length === 0 ? null : notes;
}

/** Whether something read is a note's loudness: a level or none, and a share no further than the next level. */
function isALoudness(value: unknown): value is NoteLoudness {
  const said = value as { readonly level?: unknown; readonly shade?: unknown } | null;
  return (
    typeof said === 'object' &&
    said !== null &&
    (said.level === null || DYNAMIC_LEVELS.some((level) => level === said.level)) &&
    Number.isFinite(said.shade) &&
    Math.abs(Number(said.shade)) <= 100
  );
}

/**
 * A change of key, metre or pace as it is copied from a flag: only what
 * changes there, to be changed to the same wherever it is pasted.
 */
export interface ChangeCopied {
  readonly key?: { readonly fifths: number; readonly scale: ScaleName };
  readonly metre?: { readonly beatsInBar: number; readonly beatType: number };
  readonly crotchetsPerMinute?: number;
  readonly dynamic?: DynamicLevel;
  /** The dynamic reached gradually from the one before wherever it is pasted. */
  readonly gradually?: true;
  /** The part of the piece begun there, by its name. */
  readonly section?: string;
}

/** What a change copied is called on the clipboard, so a paste can tell it from notes and any other text. */
const A_CHANGE_ON_THE_CLIPBOARD = 'sight-reading-practice/change';

/** A change copied as the text the clipboard holds. */
export function theClipboardTextOfTheChange(change: ChangeCopied): string {
  return JSON.stringify({ copied: A_CHANGE_ON_THE_CLIPBOARD, change });
}

/**
 * The change a clipboard's text holds, or `null` where it holds anything
 * else - or a change of nothing. The text may have come from anywhere, so
 * each part is asked of, and one that is not what it says refuses the
 * whole: a key, a signature a key can have and a scale this program
 * knows; a metre, a whole number of beats in a bar and a beat a note's
 * value can be; a pace, some crotchets a minute; a dynamic, a level a
 * score marks; a section, a name.
 */
export function theChangeOnTheClipboard(text: string): ChangeCopied | null {
  let read: unknown;
  try {
    read = JSON.parse(text);
  } catch {
    return null;
  }
  const said = read as { readonly copied?: unknown; readonly change?: unknown } | null;
  if (typeof said !== 'object' || said === null || said.copied !== A_CHANGE_ON_THE_CLIPBOARD) {
    return null;
  }
  const change = said.change as {
    readonly key?: unknown;
    readonly metre?: unknown;
    readonly crotchetsPerMinute?: unknown;
    readonly dynamic?: unknown;
    readonly gradually?: unknown;
    readonly section?: unknown;
  } | null;
  if (typeof change !== 'object' || change === null) {
    return null;
  }
  const key = change.key as { readonly fifths?: unknown; readonly scale?: unknown } | null | undefined;
  const metre = change.metre as { readonly beatsInBar?: unknown; readonly beatType?: unknown } | null | undefined;
  const pace = change.crotchetsPerMinute;
  const keyIsOne =
    typeof key === 'object' && key !== null && Number.isInteger(key.fifths) && Math.abs(Number(key.fifths)) <= 7 && isAScale(key.scale);
  const metreIsOne =
    typeof metre === 'object' &&
    metre !== null &&
    Number.isInteger(metre.beatsInBar) &&
    Number(metre.beatsInBar) >= 1 &&
    Number(metre.beatsInBar) <= 32 &&
    Number.isInteger(metre.beatType) &&
    [1, 2, 4, 8, 16, 32].includes(Number(metre.beatType));
  const paceIsOne = Number.isFinite(pace) && Number(pace) > 0;
  const dynamic = DYNAMIC_LEVELS.find((level) => level === change.dynamic);
  const section = typeof change.section === 'string' ? change.section.trim() : '';
  if (
    (key !== undefined && !keyIsOne) ||
    (metre !== undefined && !metreIsOne) ||
    (pace !== undefined && !paceIsOne) ||
    (change.dynamic !== undefined && dynamic === undefined) ||
    (change.gradually !== undefined && (change.gradually !== true || dynamic === undefined)) ||
    (change.section !== undefined && section === '')
  ) {
    return null;
  }
  const copied: ChangeCopied = {
    ...(keyIsOne ? { key: { fifths: Number(key.fifths), scale: key.scale as ScaleName } } : {}),
    ...(metreIsOne ? { metre: { beatsInBar: Number(metre.beatsInBar), beatType: Number(metre.beatType) } } : {}),
    ...(paceIsOne ? { crotchetsPerMinute: Number(pace) } : {}),
    ...(dynamic === undefined ? {} : { dynamic }),
    ...(change.gradually === true ? { gradually: true } : {}),
    ...(section === '' ? {} : { section }),
  };
  return Object.keys(copied).length === 0 ? null : copied;
}

/**
 * A take's events with notes copied put in from a moment on, and the keys
 * they became. One that would begin on or sound over another of its pitch,
 * there already or pasted before it, is left out: the rest of a figure is
 * still worth having where one of its notes is already played.
 */
export function takeWithTheNotesPasted(
  events: readonly MidiFileEvent[],
  notes: readonly NoteCopied[],
  atMs: number,
): { readonly events: readonly MidiFileEvent[]; readonly pasted: readonly KeyNamed[] } {
  let taken = events;
  const pasted: KeyNamed[] = [];
  for (const note of notes) {
    const key: KeyNamed = { midi: note.midi, downAtMs: Math.round(atMs + note.afterMs) };
    const struck: MidiFileEvent = {
      kind: 'noteOn',
      atMs: key.downAtMs,
      midi: note.midi,
      velocity: note.velocity,
      ...(note.hand === undefined ? {} : { hand: note.hand }),
      ...(note.loudness === undefined ? {} : { loudness: note.loudness }),
    };
    const released: MidiFileEvent = { kind: 'noteOff', atMs: Math.round(atMs + note.afterMs + note.lengthMs), midi: note.midi };
    const withIt = inTheOrderPlayed([...taken, struck, released]);
    if (!aKeyIsOverAnotherOfItsPitch(withIt, [key])) {
      taken = withIt;
      pasted.push(key);
    }
  }
  return { events: taken, pasted };
}

/**
 * The notes some playing recorded into a take from a moment on comes to, as
 * far as a moment it has got to: each timed from the playing's own nought,
 * which falls on that moment; a key still down, as far as the moment it
 * has got to. Over what is there, as a piano is played over itself: a key
 * struck again ends the note before it, so a note held into one of its
 * pitch already there ends where that one begins, and a key struck while
 * one of its pitch there is still sounding is left out. One answer for
 * what is shown while it records and what is written in when it stops.
 */
export function theNotesRecorded(
  events: readonly MidiFileEvent[],
  played: readonly MidiFileEvent[],
  atMs: number,
  untilMs: number,
): readonly NoteCopied[] {
  const there = theKeysOfTheTake(events);
  return theKeysOfTheTake(played).flatMap((key): NoteCopied[] => {
    const startsAt = atMs + key.downAtMs;
    const ofItsPitch = there.filter((each) => each.midi === key.midi);
    if (ofItsPitch.some((each) => each.downAtMs <= startsAt && startsAt < (each.upAtMs ?? Number.POSITIVE_INFINITY))) {
      return [];
    }
    const next = Math.min(...ofItsPitch.map((each) => each.downAtMs).filter((downAtMs) => downAtMs > startsAt));
    const endsAt = Math.min(atMs + (key.upAtMs ?? untilMs), next);
    return [{ afterMs: key.downAtMs, lengthMs: Math.max(0, endsAt - startsAt), midi: key.midi, velocity: key.velocity }];
  });
}

/**
 * A take's events with some playing recorded into them from a moment on, and
 * the keys of it put in: the notes it comes to (`theNotesRecorded`), and its
 * pedal with them. A key or the pedal still down when the recording stopped
 * is let go of there, or it would ring for ever.
 */
export function takeWithThePlayingRecorded(
  events: readonly MidiFileEvent[],
  played: readonly MidiFileEvent[],
  atMs: number,
  stoppedAtMs: number,
): { readonly events: readonly MidiFileEvent[]; readonly pasted: readonly KeyNamed[] } {
  const notes = theNotesRecorded(events, played, atMs, stoppedAtMs);
  const pedal = played.flatMap((event) => (event.kind === 'sustain' ? [{ ...event, atMs: Math.round(atMs + event.atMs) }] : []));
  const lastPedal = pedal[pedal.length - 1];
  const held = lastPedal !== undefined && damperIsDown(lastPedal.value);
  const released: MidiFileEvent[] = held ? [{ kind: 'sustain', atMs: Math.round(atMs + stoppedAtMs), value: 0 }] : [];
  const { events: withTheNotes, pasted } = takeWithTheNotesPasted(events, notes, atMs);
  return {
    events: pedal.length === 0 ? withTheNotes : inTheOrderPlayed([...withTheNotes, ...pedal, ...released]),
    pasted,
  };
}

/** Which way a chord broken goes through its keys: up, down, or up and back down. */
export type ArpeggioWay = 'up' | 'down' | 'upAndDown';

/**
 * The order a chord's keys are struck in, broken, before it begins again.
 * Up and back down turns on the top and the bottom rather than striking
 * either twice running: C E G becomes C E G E, and then C again.
 */
export function theKeysInTurn(midis: readonly number[], way: ArpeggioWay): readonly number[] {
  const up = [...new Set(midis)].sort((low, high) => low - high);
  if (way === 'up') {
    return up;
  }
  const down = [...up].reverse();
  return way === 'down' ? down : [...up, ...down.slice(1, -1)];
}

/**
 * A take's events with each chord of the named keys broken - the keys of it
 * that go down at one moment, two or more - into one key a step, struck in
 * turn over the chord's length, and the keys it became; or `null` where a
 * key is not there or no chord was broken.
 *
 * The steps are the lines of the grid inside the chord, its own beginning
 * and end its first and last: a finer grid breaks it faster. Each key is
 * held to the next step and struck as hard and with the hand it was. A
 * chord no line falls inside has no second step to break into and stays as
 * it is, as does a key named alone; a key that would sound over another of
 * its pitch is left out, as a paste leaves it.
 */
export function takeWithTheChordsBroken(
  events: readonly MidiFileEvent[],
  named: readonly KeyNamed[],
  lines: readonly number[],
  way: ArpeggioWay,
): { readonly events: readonly MidiFileEvent[]; readonly keys: readonly KeyNamed[] } | null {
  // A key not there leaves nothing to break, which says so already.
  const chords = new Map<number, KeyOfTheTake[]>();
  for (const key of theKeysNamed(events, named) ?? []) {
    chords.set(key.downAtMs, [...(chords.get(key.downAtMs) ?? []), key]);
  }
  let taken = events;
  const after: KeyNamed[] = [];
  for (const [fromMs, chord] of chords) {
    const untilMs = Math.max(...chord.map((key) => key.upAtMs ?? key.downAtMs));
    const steps = [fromMs, ...lines.filter((at) => at > fromMs + 0.5 && at < untilMs - 0.5), untilMs];
    const order = theKeysInTurn(
      chord.map((key) => key.midi),
      way,
    );
    const without = order.length < 2 || steps.length < 3 ? null : takeWithoutTheKeys(taken, chord);
    if (without === null) {
      after.push(...chord.map(({ midi, downAtMs }) => ({ midi, downAtMs })));
      continue;
    }
    const notes = steps.slice(0, -1).flatMap((stepMs, at): NoteCopied[] => {
      const midi = order[at % order.length];
      const struck = chord.find((key) => key.midi === midi);
      return struck === undefined
        ? []
        : [
            {
              afterMs: stepMs - fromMs,
              lengthMs: (steps[at + 1] ?? untilMs) - stepMs,
              midi: struck.midi,
              velocity: struck.velocity,
              ...(struck.hand === undefined ? {} : { hand: struck.hand }),
              ...(struck.loudness === undefined ? {} : { loudness: struck.loudness }),
            },
          ];
    });
    const broken = takeWithTheNotesPasted(without, notes, fromMs);
    taken = broken.events;
    after.push(...broken.pasted);
  }
  return taken === events ? null : { events: taken, keys: after };
}

/**
 * A take's events with a key cut in two at a moment inside it: the first part
 * let go of there, and the second struck there, as loud and in the same hand,
 * held to where the key was held - or `null` where the key is not there or
 * the moment is not inside it.
 */
export function takeWithTheKeyCut(
  events: readonly MidiFileEvent[],
  named: KeyNamed,
  atMs: number,
): readonly MidiFileEvent[] | null {
  const [key] = theKeysNamed(events, [named]) ?? [];
  const struck = key === undefined ? undefined : events[key.on];
  if (key === undefined || struck?.kind !== 'noteOn' || atMs <= key.downAtMs || atMs >= (key.upAtMs ?? Number.POSITIVE_INFINITY)) {
    return null;
  }
  // At one moment a release is written before a press, so the release pairs
  // with the first part and the original release is left to the second.
  return inTheOrderPlayed([...events, { kind: 'noteOff', atMs, midi: key.midi }, { ...struck, atMs }]);
}

/**
 * A take's events with the pedal held down - or let go of - from one moment
 * to another, and left as it was everywhere else: after the stretch it is
 * where it was, half-pedalled or not.
 *
 * A stretch held down over a press of the pedal joins it into one; one that
 * only meets another at an end stays a press of its own, let go of and
 * pressed again at that instant, which is a change of pedal and not one long
 * press. Let go of inside a press, it leaves two. `untilMs` may be endless,
 * for a press still down at the end.
 *
 * At one instant the events are read in the order they stand, so a let-go
 * written before a press there is a change of pedal; and inside the stretch an
 * event that says nothing - a press while down, a let-go while up - is
 * dropped rather than left to say it.
 */
export function takeWithThePedalAt(
  events: readonly MidiFileEvent[],
  fromMs: number,
  untilMs: number,
  down: boolean,
): readonly MidiFileEvent[] {
  if (!(untilMs > fromMs)) {
    return events;
  }
  const pedalled = (event: MidiFileEvent): event is MidiFileEvent & { readonly kind: 'sustain' } =>
    event.kind === 'sustain';
  const isDown = (value: number): boolean => value >= 0.5;
  /** How far down the pedal was just before a moment, as the events have it. */
  const valueBefore = (atMs: number): number => events.filter(pedalled).filter((event) => event.atMs < atMs).at(-1)?.value ?? 0;
  const atTheStart = events.filter(pedalled).filter((event) => event.atMs === fromMs);
  const atTheEnd = events.filter(pedalled).filter((event) => event.atMs === untilMs);
  const downBefore = isDown(valueBefore(fromMs));
  // A press let go of exactly where this begins: meeting it, not over it.
  const endedAtTheStart = downBefore && atTheStart.some((event) => !isDown(event.value));

  const written: MidiFileEvent[] = [];
  if (down) {
    if (endedAtTheStart) {
      written.push({ kind: 'sustain', atMs: fromMs, value: 0 });
    }
    written.push({ kind: 'sustain', atMs: fromMs, value: 1 });
  } else {
    written.push({ kind: 'sustain', atMs: fromMs, value: 0 });
  }
  if (Number.isFinite(untilMs)) {
    const last = atTheEnd.at(-1);
    if (last !== undefined) {
      // What happens at the end already says what follows it; held down into
      // a press beginning there, it is let go of first, so the two stay two.
      if (down && isDown(last.value)) {
        written.push({ kind: 'sustain', atMs: untilMs, value: 0 });
      }
    } else {
      const after = valueBefore(untilMs);
      if (isDown(after) !== down) {
        written.push({ kind: 'sustain', atMs: untilMs, value: after });
      }
    }
  }
  const kept = events.filter((event) => !(pedalled(event) && event.atMs >= fromMs && event.atMs < untilMs));
  // Written first, so at one instant they stand before what was there.
  const ordered = inTheOrderPlayed([...written, ...kept]);
  let held = false;
  return ordered.filter((event) => {
    if (!pedalled(event)) {
      return true;
    }
    const says = isDown(event.value);
    const inside = event.atMs >= fromMs && event.atMs <= untilMs;
    if (event.atMs < fromMs) {
      held = says;
      return true;
    }
    if (inside && says === held && (event.value === 0 || event.value === 1)) {
      return false;
    }
    held = says;
    return true;
  });
}

/** How far humanizing moves a key's loudness at most, either way, in MIDI's 127 steps. */
export const HUMANIZED_BY_AT_MOST = 10;

/**
 * How far humanizing takes a key written at a level, at most, either way: a
 * share of the way to the next level, so it is always nearer its own level
 * than any other, and the level it is written at - the one a score prints -
 * is never in doubt.
 */
export const HUMANIZED_SHADE_AT_MOST = 50;

/**
 * The named keys each struck a little harder or softer, as no hand strikes
 * two keys alike: one played by up to `HUMANIZED_BY_AT_MOST` steps either
 * way and within 1 to 127; one written at a level anywhere up to
 * `HUMANIZED_SHADE_AT_MOST` of the way to the next, its level kept. Where
 * they are and how long they are held left as they were. One that comes out
 * as loud as it was is left out.
 *
 * Random, but drawn from the keys themselves - where each is and how loud -
 * so the same keys give the same answer, and humanized again, being other
 * loudnesses by then, give another.
 */
export function theKeysHumanized(events: readonly MidiFileEvent[], named: readonly KeyNamed[]): readonly KeyChange[] {
  const keys = theKeysNamed(events, named) ?? [];
  const steps = (key: KeyOfTheTake): number => Math.round(key.velocity * 127);
  let seed = 0x811c9dc5;
  for (const key of keys) {
    for (const part of [key.midi, key.downAtMs, steps(key)]) {
      seed = Math.imul(seed ^ Math.round(part), 0x01000193) >>> 0;
    }
  }
  const rng = createRng(seed);
  return keys.flatMap((key): KeyChange[] => {
    const named = { key: { midi: key.midi, downAtMs: key.downAtMs }, midi: key.midi, downAtMs: key.downAtMs, upAtMs: key.upAtMs };
    if (key.loudness !== undefined) {
      const shade = rng.int(-HUMANIZED_SHADE_AT_MOST, HUMANIZED_SHADE_AT_MOST);
      return shade === key.loudness.shade ? [] : [{ ...named, loudness: { level: key.loudness.level, shade } }];
    }
    const was = steps(key);
    const struck = Math.min(127, Math.max(1, was + rng.int(-HUMANIZED_BY_AT_MOST, HUMANIZED_BY_AT_MOST)));
    return struck === was ? [] : [{ ...named, velocity: struck / 127 }];
  });
}

/**
 * Where the named keys go put on the grid: each begun on the line nearest
 * where it begins, and held as long as it was. One already on a line is left
 * out, and so is one that would begin on or sound over another of its pitch.
 * Taken earliest first, each asked of against the others where they are by
 * then, moved or not yet: putting two on the grid can bring them together.
 */
export function theKeysOnTheGrid(
  roll: RunRoll,
  events: readonly MidiFileEvent[],
  named: readonly KeyNamed[],
  choice: GridChoice,
): readonly KeyChange[] {
  const keys = theKeysNamed(events, named) ?? [];
  const began = rollBeganAtMs(roll);
  const placed: KeyChange[] = [];
  for (const key of [...keys].sort((one, other) => one.downAtMs - other.downAtMs)) {
    const byMs = Math.round(theBeatNearest(roll, key.downAtMs - began, choice) + began) - key.downAtMs;
    if (byMs === 0) {
      continue;
    }
    const change: KeyChange = {
      key: { midi: key.midi, downAtMs: key.downAtMs },
      midi: key.midi,
      downAtMs: key.downAtMs + byMs,
      upAtMs: key.upAtMs === null ? null : key.upAtMs + byMs,
    };
    const moved = takeWithTheKeysChanged(events, [...placed, change]);
    if (moved !== null && !aKeyIsOverAnotherOfItsPitch(moved, [change])) {
      placed.push(change);
    }
  }
  return placed;
}

/**
 * The bars of a roll counted on its own downbeats, from one: for a drawing
 * that is of no score, whose bars have no other number.
 */
export function barsCountedOnItsBeats(roll: RunRoll): (positionTicks: number) => string | null {
  const downbeats = roll.beats.filter((beat) => beat.weight === 'downbeat').map((beat) => beat.positionTicks);
  return (positionTicks) => {
    const at = downbeats.indexOf(positionTicks);
    return at < 0 ? null : String(at + 1);
  };
}

/**
 * The score itself, as something the MIDI viewer can draw and play.
 *
 * Drawn with every note the music wrote, its pedal marks, and its beats -
 * without deviations, rushes or waits, because this is the music before
 * anybody played it.
 *
 * Its notes are marked as correct so the drawing gives them their colour
 * rather than the empty outline of an unjudged press, and each carries its
 * step in the timeline so replay and the keyboard recognise them.
 */
export function rollOfTheScore(exercise: Exercise, timeline: ExerciseTimeline): RunRoll {
  const bars = barLines(exercise);
  const presses: RolledPress[] = [];
  for (const step of timeline.steps) {
    const downAtMs = elapsedMsAt(exercise, step.onsetTicks);
    const measureStart = bars[step.measureIndex]?.startTicks ?? 0;
    const offsetTicks = step.onsetTicks - measureStart;
    for (const note of notesStruckAt(step, null)) {
      presses.push({
        midi: note.midi,
        downAtMs,
        upAtMs: elapsedMsAt(exercise, step.onsetTicks + soundsFor(note)),
        velocity: velocityAt(exercise, step.measureIndex, offsetTicks, note.staffNumber),
        verdict: 'correct',
        stepIndex: step.index,
        deviationMs: null,
      });
    }
  }

  const beats: RolledBeat[] = [];
  for (const bar of bars) {
    const pulse = bar.timeSignature.ticksPerPulse;
    for (
      let tick = bar.startTicks;
      tick < bar.startTicks + bar.timeSignature.ticksPerMeasure;
      tick += pulse
    ) {
      const into = tick - bar.startTicks;
      beats.push({
        atMs: elapsedMsAt(exercise, tick),
        weight: into === 0 ? 'downbeat' : 'beat',
        positionTicks: tick,
      });
    }
  }

  const pedal: RolledPedal[] = pedalSpans(exercise).map(([down, up]) => ({
    downAtMs: elapsedMsAt(exercise, down),
    upAtMs: elapsedMsAt(exercise, up),
  }));

  return {
    presses,
    beats,
    pedal,
    rushes: [],
    truncated: false,
  };
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
