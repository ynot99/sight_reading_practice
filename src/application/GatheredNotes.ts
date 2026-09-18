import {
  barLines,
  elapsedMsAt,
  pedalHeldUntil,
  spanMs,
  velocityAt,
} from '../domain/model/Exercise.js';
import { soundsFor } from '../domain/timeline/Timeline.js';
import type { ExerciseTimeline, TimelineOrnament } from '../domain/timeline/Timeline.js';
import { lastOfLeadingRun } from '../shared/leadingRun.js';

/** One note the player still has to start and stop. */
export interface ScheduledNote {
  readonly midi: number;
  readonly atMs: number;
  readonly untilMs: number;
  /** How hard to strike it, `0..1`, from the dynamics on the page. */
  readonly velocity: number;
}

/**
 * The longest a grace note with a stroke through its stem is held.
 *
 * An acciaccatura is a flick of the finger and stays one at every tempo. Its
 * written value is an eighth as often as not, which at forty to the crotchet
 * is three quarters of a second - a note, and one nobody wrote.
 */
const CRUSH_MS = 70;
/** The gap between an ornament and the note it leans on, so the two are two. */
const GRACE_GAP_MS = 6;

/**
 * Delay between consecutive notes of a rolled chord.
 *
 * A hand rolls a chord in roughly the time it takes to say it - fast enough
 * to be one gesture, slow enough that the notes are separately heard. Below
 * about 25 ms it is a flam rather than an arpeggio; above about 60 it is a
 * broken chord the writer would have notated as one.
 */
const ROLL_STEP_MS = 38;

/**
 * How much of a step a roll may occupy.
 *
 * Without a cap the same 38 ms per note that sounds right at 60 bpm runs a
 * five-note chord into the one after it at 160. Half the step keeps the roll
 * inside the beat it belongs to, whatever the tempo.
 */
const ROLL_SHARE_OF_STEP = 0.5;

/**
 * When each note of a rolled chord sounds, relative to the chord's onset.
 *
 * The roll *starts* on the beat rather than arriving on it: the cursor is at
 * that step and the click sounds there, so a roll that finished on the beat
 * would leave the lowest note - the one carrying the harmony - audibly early
 * against both. Notes are already sorted low to high, which is the direction
 * a hand rolls unless told otherwise.
 */
function rollOffsets(rolled: number, stepMs: number): number[] {
  if (rolled <= 1) {
    return [0];
  }
  const perNote = Math.min(ROLL_STEP_MS, (stepMs * ROLL_SHARE_OF_STEP) / (rolled - 1));
  return Array.from({ length: rolled }, (_, at) => at * perNote);
}

/**
 * Where a run of grace notes goes, and how long each of them lasts.
 *
 * In front of the note they lean on, because that is the only room they
 * have: an ornament takes no time from the bar, so the beat cannot move for
 * one - the marker, the metronome and the judging all agree on where it is.
 * Which is how an acciaccatura is played in any case, and near enough for
 * the rest that hearing them beats not hearing them.
 *
 * A crushed one keeps its flick at every tempo: at forty to the crotchet
 * its written value would last a third of a second, which is not a crush
 * but a note. The run is then squeezed into whatever room stands between it
 * and the note before, so an ornament never swallows the note it leans away
 * from - and at the very start of a run, where there is nothing before it,
 * it keeps its length and sounds a moment early.
 */
function graceRun(
  graces: readonly TimelineOrnament[],
  onsetMs: number,
  previousMs: number | null,
  lengthOf: (ornament: TimelineOrnament) => number,
): readonly { readonly atMs: number; readonly untilMs: number }[] {
  const wanted = graces.map(lengthOf);
  const total = wanted.reduce((sum, ms) => sum + ms, 0);
  const room =
    previousMs === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, onsetMs - GRACE_GAP_MS - previousMs);
  const squeeze = total > room && total > 0 ? room / total : 1;
  const placed: { atMs: number; untilMs: number }[] = [];
  let atMs = onsetMs - GRACE_GAP_MS - total * squeeze;
  for (const ms of wanted) {
    const length = ms * squeeze;
    placed.push({ atMs, untilMs: atMs + length });
    atMs += length;
  }
  return placed;
}

/**
 * Every note to sound in a stretch of the piece, timed from where it begins,
 * and gathered as the performance reaches it.
 *
 * `durationTicks` on a timeline note already follows any ties out of it, so
 * a note held across a bar line is one sound of the right length rather than
 * two of the wrong one. The damper pedal is applied here rather than through
 * the instrument's own pedal, which belongs to the player's feet: a note
 * struck under the pedal simply rings until the pedal comes up, which is the
 * same thing said in the only terms this schedule has.
 *
 * Gathered as asked for rather than all before the music begins. A performance
 * needs the notes of the next quarter of a second, and gathering every one to
 * the end of the piece first was, once everything else about starting had
 * been made quick, most of the wait that was left: on the longest score he
 * owns, fifty to a hundred milliseconds, and more the further from its end the
 * music began. His idea: "чи можливо 'notes collected' не всі".
 *
 * In exactly the order and with exactly the timing the whole list had. A note
 * is handed out only once nothing still to gather could sound in front of it.
 * An ornament leans back from the note it decorates as far as the step before
 * that note and no further, and everything else sounds on or after its own
 * step - so once a step is gathered, whatever sounds before the step ahead of
 * it is settled.
 */
export class GatheredNotes {
  private readonly timeline: ExerciseTimeline;
  private readonly staffNumber: number | null;
  private readonly untilTicks: number;
  /** Where the performance begins on the clock; every note is timed from it. */
  private readonly beganMs: number;
  /** The next step to gather, by its place in the timeline. */
  private nextStep: number;
  /** Where the last step gathered sounded, which is as far back as an ornament may reach. */
  private previousMs: number | null = null;
  /** In the order they sound, and final. */
  private readonly settled: ScheduledNote[] = [];
  /** Gathered, but a note still to be gathered could yet sound in front of one of them. */
  private unsettled: ScheduledNote[] = [];
  private finished = false;
  private gathered = 0;

  constructor(
    timeline: ExerciseTimeline,
    staffNumber: number | null,
    fromTicks: number,
    untilTicks: number,
  ) {
    this.timeline = timeline;
    this.staffNumber = staffNumber;
    this.untilTicks = untilTicks;
    // Read off the clock rather than multiplied: a piece that changes tempo
    // has no single number to multiply by.
    this.beganMs = elapsedMsAt(timeline.exercise, fromTicks);
    // The first step of the stretch, found rather than walked to.
    this.nextStep = lastOfLeadingRun(timeline.steps, (step) => step.onsetTicks < fromTicks) + 1;
  }

  /** How many steps of the music have been gathered so far. */
  get stepsGathered(): number {
    return this.gathered;
  }

  /** The nth note in the order they sound, or `null` past the last. */
  at(index: number): ScheduledNote | null {
    while (this.settled.length <= index && !this.finished) {
      this.gatherTheNextStep();
    }
    return this.settled[index] ?? null;
  }

  /** How many there are - which means gathering every one of them. */
  get length(): number {
    while (!this.finished) {
      this.gatherTheNextStep();
    }
    return this.settled.length;
  }

  private gatherTheNextStep(): void {
    const step = this.timeline.steps[this.nextStep];
    // Only the stretch being played.
    if (step === undefined || step.onsetTicks >= this.untilTicks) {
      this.settleBefore(Number.POSITIVE_INFINITY);
      this.finished = true;
      return;
    }
    this.nextStep += 1;
    this.gathered += 1;
    const exercise = this.timeline.exercise;
    const staffNumber = this.staffNumber;
    const at = (ticks: number): number => elapsedMsAt(exercise, ticks) - this.beganMs;
    const longest = new Map<string, ScheduledNote>();

    const sounding = step.notes.filter(
      (note) => staffNumber === null || note.staffNumber === staffNumber,
    );
    // Dynamics are placed as a bar and an offset into it, which is how the
    // format places a direction; the timeline counts from the beginning of
    // the piece.
    const measureStart = barLines(exercise)[step.measureIndex]?.startTicks ?? 0;
    // Counted after the hand filter: listening to one hand of a roll
    // written across both is listening to that hand alone, and it starts
    // where the reader's own would.
    const offsets = rollOffsets(
      sounding.filter((note) => note.arpeggiated).length,
      spanMs(exercise, step.onsetTicks, step.onsetTicks + step.durationTicks),
    );
    // The pedal and the clock are facts about the moment, so every note
    // struck at it shares them.
    const heldUntil = pedalHeldUntil(exercise, step.onsetTicks);
    const onsetMs = at(step.onsetTicks);
    let rolled = 0;
    for (const note of sounding) {
      const offset = note.arpeggiated ? (offsets[rolled] ?? 0) : 0;
      if (note.arpeggiated) {
        rolled += 1;
      }
      const startsAt = onsetMs + offset;
      // As long as it sounds rather than as long as it is written - and the
      // pedal still wins, because a note struck under the damper rings until
      // the damper lifts whatever the writer marked it.
      const endTicks = Math.max(step.onsetTicks + soundsFor(note), heldUntil ?? 0);
      const until = at(endTicks);
      // Two voices may notate the same sounding pitch at the same instant.
      // That is one key on the keyboard and must be one sound here: striking
      // it twice doubles the attack into an audible knock. The longer of the
      // two wins, since the key stays down until the last of them lets go.
      const seen = String(note.midi);
      const previous = longest.get(seen);
      if (previous === undefined || previous.untilMs < until) {
        // A rolled note is released with the rest of the chord - the hand
        // lifts once - so only the attack moves. `Math.max` is the guard
        // for a roll that a very short step has squeezed to nothing.
        longest.set(seen, {
          midi: note.midi,
          atMs: startsAt,
          untilMs: Math.max(until, startsAt),
          // What the page asks for where this note falls: the level in
          // force, lifted or lowered by any hairpin drawn over it. A
          // staff's own marks are preferred to the piece's, which is how a
          // piano part with the left hand marked `p` under a melody marked
          // `f` is written.
          velocity: velocityAt(
            exercise,
            step.measureIndex,
            step.onsetTicks - measureStart,
            note.staffNumber,
          ),
        });
      }
    }

    // The ornaments printed here, laid in front of the note they lean on.
    // Keyed apart from the notes: a grace may be the same key as the note
    // it decorates, and that is two presses rather than one.
    // One run per hand. Both may ornament the same beat, and two ornaments
    // written in two hands are played together rather than one after the
    // other - laid end to end they would push the left hand's back past
    // where the right hand's began.
    const byHand = new Map<number, TimelineOrnament[]>();
    for (const ornament of step.ornaments) {
      if (staffNumber !== null && ornament.staffNumber !== staffNumber) {
        continue;
      }
      byHand.set(ornament.staffNumber, [...(byHand.get(ornament.staffNumber) ?? []), ornament]);
    }
    for (const [hand, graces] of byHand) {
      const placed = graceRun(graces, onsetMs, this.previousMs, (ornament) => {
        const written = spanMs(exercise, step.onsetTicks, step.onsetTicks + ornament.duration.ticks);
        return ornament.slashed ? Math.min(written, CRUSH_MS) : written;
      });
      for (const [index, ornament] of graces.entries()) {
        const where = placed[index];
        if (where === undefined) {
          continue;
        }
        for (const pitch of ornament.pitches) {
          longest.set(`grace${String(hand)}.${String(index)}:${String(pitch.midi)}`, {
            midi: pitch.midi,
            atMs: where.atMs,
            untilMs: where.untilMs,
            velocity: velocityAt(
              exercise,
              step.measureIndex,
              step.onsetTicks - measureStart,
              ornament.staffNumber,
            ),
          });
        }
      }
    }

    this.unsettled.push(...longest.values());
    // Nothing gathered after this step can sound before the step ahead of it:
    // an ornament of the next step leans back no further than this one.
    const settledUpTo = this.previousMs;
    this.previousMs = onsetMs;
    if (settledUpTo !== null) {
      this.settleBefore(settledUpTo);
    }
  }

  /** Hands out, in order, every gathered note that sounds before `moment`. */
  private settleBefore(moment: number): void {
    // Stable, so notes at one moment keep the order they were gathered in -
    // which is the order the whole list was once sorted from.
    this.unsettled.sort((left, right) => left.atMs - right.atMs);
    const later = this.unsettled.findIndex((note) => note.atMs >= moment);
    const ready = later < 0 ? this.unsettled.length : later;
    for (const note of this.unsettled.slice(0, ready)) {
      this.settled.push(note);
    }
    this.unsettled = this.unsettled.slice(ready);
  }
}
