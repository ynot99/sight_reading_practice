import type { MidiNoteOnEvent } from '../ports/IMidiSource.js';
import type { PracticeContext } from '../session/PracticeContext.js';
import { FlowMode } from './FlowMode.js';
import type { PracticeStep } from './IPracticeMode.js';

export const NOTE_MODE_ID = 'mode.note';

/**
 * Flow, with a gate at every note the reader is asked for.
 *
 * His, against the frame that waits: "стрибання у wait for notes до наступних
 * нот фундаментально неправильний режим". Wait jumps the cursor to the next
 * note the instant the last one is played, so the time between notes - the
 * rhythm - is never asked for, and a press can never be early. Here the music
 * runs as written, clicks and all, and only stands still where the reader has
 * not played: the time is tested, and a stumble costs a wait rather than the
 * rest of the piece.
 *
 * The beat falls as it is written. The reader has the note's Perfect window to
 * meet it - early or late within it is Perfect, earlier is Good and the music
 * goes on - and when the window closes with the note unplayed, the music
 * stands at the note until it is. That press is the beat, as a bar line's is
 * in Bar mode: the music is counted again from it, and the time it stood is
 * written down as a wait. His: "краще зупинятись на perfect моменті, та буде
 * для гравця тест на те, щоб хоча б не натискати рано".
 *
 * Not Bar mode with its gate moved. There the pulse falls silent *at* the gate
 * and the reader gives the downbeat; at every note that would be no pulse at
 * all. So here the pulse is held just past the next unplayed note instead -
 * see `IPracticeMode.holdsPastTheGate` - and moved on as each is played.
 *
 * A chord opens its gate when all of it has been played, and wrong notes open
 * nothing. Rests are carried by the clock: a gate stands only where a press is
 * asked for.
 */
export class NoteMode extends FlowMode {
  override readonly id = NOTE_MODE_ID;
  override readonly label = 'Wait at every note';
  override readonly holdsPastTheGate = true;

  override holdsAt(context: PracticeContext, step: PracticeStep): number | null {
    // The matcher rather than the step's own notes, for the reason Wait mode
    // gives: a step can hold notes this reader is not being asked for, and a
    // gate on one of those would never open.
    return context.matcher === null ? null : step.onsetTicks;
  }

  override onNoteOn(context: PracticeContext, event: MidiNoteOnEvent): void {
    if (this.foundTheMusicStanding(context, event)) {
      this.giveTheBeatWith(context, event);
      return;
    }
    super.onNoteOn(context, event);
    this.openIfPlayed(context, event);
  }

  /** A press kept for this note, ahead of it: in time by being early. */
  protected override judgeTheHeldPress(context: PracticeContext, event: MidiNoteOnEvent): void {
    super.judgeTheHeldPress(context, event);
    this.openIfPlayed(context, event);
  }

  private foundTheMusicStanding(context: PracticeContext, event: MidiNoteOnEvent): boolean {
    const closes = context.gateClosesAtMs;
    return closes !== null && event.timestampMs > closes;
  }

  /** The note's gate, opened in time: the music goes on as it was going. */
  private openIfPlayed(context: PracticeContext, event: MidiNoteOnEvent): void {
    if (context.holdingAtBarLine && context.matcher?.completed === true) {
      context.startTheHeldBarAt(event.timestampMs);
    }
  }

  /**
   * A press at a note the music is standing at.
   *
   * No deviation, as at a bar line in Bar mode: the clock is standing still,
   * and a press measured against it would be measured against nothing. The
   * note is where the reader puts it, and the music starts again from there.
   */
  private giveTheBeatWith(context: PracticeContext, event: MidiNoteOnEvent): void {
    const matcher = context.matcher;
    if (matcher === null) {
      context.judgeNote(event.midi, 'wrong', null, event.timestampMs);
      return;
    }
    const outcome = matcher.accept(event.midi, event.timestampMs);
    context.judgeNote(
      event.midi,
      outcome.verdict,
      outcome.verdict === 'correct' ? 0 : null,
      event.timestampMs,
    );
    if (outcome.completed) {
      context.startTheHeldBarAt(event.timestampMs);
    }
  }
}
