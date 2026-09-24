import type { PracticeSettings } from '../PracticeController.js';

/** The squares a reader can turn on, in the order they are shown. */
export const CHALLENGE_MODES: readonly string[] = ['survival', 'blind', 'rhythm', 'strict', 'cursor'];

/**
 * What a mode square is, said once.
 *
 * Each is a setting that already exists, read and written through this rather
 * than duplicated by it: there is one answer to "am I playing survival", and
 * the square is another way of asking it. `blind` is the veil drawn over the
 * step under the reader's fingers, which is what makes it blind - the note is
 * gone by the time they reach it, so it has to have been read already.
 *
 * Here rather than in the view because a reading kept in the history says what
 * it was played with, and a second list of what "survival" means would be a
 * second answer to the same question.
 */
export function modeIsOn(mode: string, settings: PracticeSettings): boolean {
  switch (mode) {
    case 'survival':
      return settings.survival;
    case 'blind':
      return settings.readAheadSteps !== null && settings.readAheadSteps >= 1;
    case 'rhythm':
      return settings.rhythmOnly;
    case 'strict':
      return settings.stopAtAMistake;
    // Read the other way round, because the square is the challenge and the
    // setting is the comfort: on means the marker is gone and the reader is
    // keeping the place themselves.
    case 'cursor':
      return !settings.cursorWhileRunning;
    default:
      return false;
  }
}

/** The squares that are on, by name. */
export function modesOn(settings: PracticeSettings): readonly string[] {
  return CHALLENGE_MODES.filter((mode) => modeIsOn(mode, settings));
}

/** The settings a square writes when it is turned on or off. */
export function settingsForMode(mode: string, on: boolean): Partial<PracticeSettings> {
  switch (mode) {
    case 'survival':
      return { survival: on };
    case 'blind':
      return { readAheadSteps: on ? 1 : null };
    // Each of these empties the other, so each turns the other off - "one
    // wrong note ends the run" and "any note counts" cannot both be the
    // answer. His: both squares answer, rather than one of them refusing.
    // Turning either *off* leaves the other alone: it was already off.
    case 'rhythm':
      return on ? { rhythmOnly: true, stopAtAMistake: false } : { rhythmOnly: false };
    case 'strict':
      return on ? { stopAtAMistake: true, rhythmOnly: false } : { stopAtAMistake: false };
    case 'cursor':
      return { cursorWhileRunning: !on };
    default:
      return {};
  }
}
